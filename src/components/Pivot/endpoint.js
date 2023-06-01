// NodeJS Express endpoint for retrieving collections.
// This should be run from the command line thus:
//   $ node endpoint
// which will run this endpoint on port 3000.
//
// Requires mongodb version 3.6 or better (implements $sum).
//
// Also, this works:
//  $ npm install --save-dev nodemon  ... to install nodemon
//  $ nodemon endpoint                ... restarts node when needed
//
/* eslint-disable no-console */

import transforms from './transforms.js';
import reader from './reader.js';
import metadata from './metadata.js';
import datapoint from './datapoint.js';
import constants from './constants.js';
import { connect } from './env.js';

import express from 'express';
import fs from 'fs';
import path from 'path';
import morgan from 'morgan';

// From Apollo Server docs, https://www.apollographql.com/docs/apollo-server/getting-started/
//
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import cors from 'cors';
import http from 'http';
import { json } from 'body-parser';

import { PrismaClient } from '@prisma/client';

// Allows introspection of the prisma/schema.prisma file
//
import { getSchema } from '@mrleebo/prisma-ast';

const prisma = new PrismaClient({ log: ['query'] });
const database = "pivotDb";

const books = [
  {
    title: 'The Awakening',
    author: 'Kate Chopin',
  },
  {
    title: 'City of Glass',
    author: 'Paul Auster',
  },
];

// import { startStandaloneServer } from '@apollo/server/standalone';

// A schema is a collection of type definitions (hence "typeDefs")
// that together define the "shape" of queries that are executed against
// your data.
//
const typeDefs = `#graphql

  # Root query object type
  #
  type Query {
    books(author: String, title: String, limit: Int): [Book]
    coasters(filter: String, skip: Int, take: Int): [Coaster]
    datasets(name: String): [Dataset]
    columns(type: String): [Column]
  }

  # Fake example, returning data from plain old json
  #
  type Book {
    title: String
    author: String
  }

  # A simple collection of rows in Mongo
  #
  type Coaster {
    name: String
    country: String
    length: Int
  }

  # Datasets that MetaPivot supports.
  # Base dataset is in metadata.js.
  #
  type Dataset {
    name: String!
    alias: String
    show: Boolean
    columns(types: [String], subtypes: [String], names: [String]): [Column]!
  }

  # Columns of a particular Dataset.
  # The 'values' supports a Colum where type === 'Categorical'.
  #
  type Column {
    name: String!
    type: String!
    subtype: String
    alias: String
    valuesPrisma: [String]!
    values: [String]!
  }
`;

// Given an object representing prisma/schema.prisma (the Prisma schema),
// return an object that maps real column names to Prisma mapped names.
//
// We need this because Prisma schema syntax does not allow all of the column names
// that Mongo (e.g.) does.  But internally we use Mongo names.
//
// This allows us to treat the Prisma schema as co-authoritative with metadata.js.
//
const getPrismaNameMap = schema => {
  const list = schema !== null && schema.type === 'schema' && Array.isArray(schema.list) ? schema.list : [];
  const pass1 = list.filter((i => i.type === 'model')).map(i => {
    const collectionName = i.name;
    const props = Array.isArray(i.properties) ? i.properties : [];
    const allFields = props.filter(j => j.type === 'field').map(j => {
      const prismaFieldName = j.name;
      const attrs = Array.isArray(j.attributes) ? j.attributes : [];

      // Get just the @map attribute.  Only get one of them.
      //
      const filteredAttrs = attrs.filter(k => k.type === 'attribute' && k.kind === 'field' && k.name === 'map');
      const oneMapAttr = filteredAttrs.length > 0 ? filteredAttrs[0] : null;
      const mapAttrArgs = oneMapAttr === null
        ? []
        : Array.isArray(oneMapAttr.args)
        ? oneMapAttr.args
        : []
        ;
      const filteredMapAttrArgs = mapAttrArgs.filter(k => k.type === 'attributeArgument');
      const oneAttrArg = filteredMapAttrArgs.length > 0 ? filteredMapAttrArgs[0] : null;
      const quotedMongoFieldName = oneAttrArg ? oneAttrArg.value : null;

      // The @map attr always(?) surrounds the original Mongo field name with double-quotes.
      // Remove them.
      //
      // Also note that sometimes there is a double-backslash in quotedMongoFieldName.
      //
      const len = quotedMongoFieldName === null ? 0 : quotedMongoFieldName.length;
      const mongoFieldName = quotedMongoFieldName !== null &&
          quotedMongoFieldName[0] === '"' && quotedMongoFieldName[len-1] === '"'
        ? quotedMongoFieldName.substring(1, len-1)
        : quotedMongoFieldName;

      return { prismaFieldName, mongoFieldName };
    });
    return { collectionName, allFields };
  });

  const pass2 = pass1.filter(i => {
    const allFields = i.allFields.filter(j => j.mongoFieldName !== null);
    return allFields.length > 0;
  }).map(i => {
    const allFields = i.allFields.filter(j => j.mongoFieldName !== null);
    return { ...i, allFields };
  });
  
  const nameMap = pass2.reduce((i, j) => {
    const innerMap = j.allFields.reduce((k, l) => {
      const { mongoFieldName, prismaFieldName } = l;
      return { ...k, ...{[mongoFieldName]: prismaFieldName} };
    }, {});
    return { ...i, ...{[j.collectionName]: innerMap} };
  }, {});
  return nameMap;
}

// Convert native database (mongo) name into name from Prisma schema.
//
const getPrismaName = (prismaNameMap, dataset, mongoName) => {
  return (prismaNameMap.hasOwnProperty(dataset) && prismaNameMap[dataset].hasOwnProperty(mongoName))
    ? prismaNameMap[dataset][mongoName]
    : mongoName;
}

// We'll do this here, rather than locally, for speed.  The prisma schema changes only when
// the Mongo database schema itself changes.
//
const source = fs.readFileSync(path.resolve(__dirname + '../../../../prisma', 'schema.prisma'), 'utf8');
const schema = getSchema(source);
const prismaNameMap = getPrismaNameMap(schema);

// Resolvers define how to fetch the types defined in your schema.
// This resolver retrieves books from the "books" array above.
//
const resolvers = {
  Query: {
    books: (parent, args) => {
      const { author, limit } = args;
      const withAuthor = author ? books.filter(i => {
        return i.author.toLowerCase().match(author.toLowerCase());
      }) : books;
      return Number(limit) ? withAuthor.slice(limit) : withAuthor;
    },

    // General purpose pagination and filtering interface.
    // This only supports a filter on 'Coaster.name'.
    //
    // We could extend the search filter to allow it to expose more
    // of the prisma 'where' filter, but...you get the idea...
    //
    coasters: async (parent, args, context) => {
      const { filter, skip, take } = args;
      const { prisma } = context;
      const where = filter ? { name: { contains: filter } } : {};
      return prisma.vekoma.findMany({where, skip, take});
    },

    datasets: (_, args) => {
      const { name } = args;
      const datasets = metadata.getAllDatasets();
      const res = datasets.filter(i => !name || i.name === name);
      return res;
    },
  },

  // Child relationships here.
  //
  Dataset: {
    columns: (parent, args) => {
      const { names, types, subtypes } = args;
      const getHash = array => {
        return Array.isArray(array) 
          ? array.reduce((i, j) => ({ ...i, ...{[j]: true} }), {})
          : {}
      }
      const typeMap = getHash(types);
      const subtypeMap = getHash(subtypes);
      const nameMap = getHash(names);

      const dataset = parent.name;
      return metadata
        .getAllColsForDataset(dataset)
        .filter(i => {
          const typeKeys = Object.keys(typeMap);
          const subtypeKeys = Object.keys(subtypeMap);
          const nameKeys = Object.keys(nameMap);
          return (typeKeys.length !== 0 && i.type && typeMap.hasOwnProperty(i.type)) ||
            (subtypeKeys.length !== 0 && i.subtype && subtypeMap.hasOwnProperty(i.subtype)) ||
            (nameKeys.length !== 0 && i.name && nameMap.hasOwnProperty(i.name)) ||
            (nameKeys.length === 0 && typeKeys.length === 0 && subtypeKeys.length === 0);
          })
        .map(i => ({ ...i, dataset }));
    },
  },

  // Get the set of distinct values of a particular column (presumably a categorical variable).
  //
  Column: {
    valuesPrisma: async (parent, _, context) => {

      // Here, 'name' is the name of the MongoDB column, which may NOT be the same
      // as the Prisma schema column.  We'll need the Prisma column in order to
      // use Prisma functions (e.g. findMany).
      //
      const { name, dataset } = parent;
      const { prisma } = context;

      const prismaName = getPrismaName(prismaNameMap, dataset, name);

      if (dataset && prisma.hasOwnProperty(dataset)) {
        const select = { [ prismaName ]: true };
        const options = { select, distinct: [ prismaName ] };
        try {
          const res = (await prisma[dataset].findMany(options)).map(i => i[prismaName]);
          return res;
        } catch (e) {
          console.log('...Column.values FAILED, error='); console.log(e);
          return [];
        };
      } else {
        return [];
      }
    },

    values: async (parent, _, context) => {
      const { name, dataset } = parent;
      const { connectString } = context;

      if (dataset) {
        try {
          const client = await reader.connect(connectString);
          const db = client.db(database);
          return db.collection(dataset).distinct(name);
        } catch(e) {
          console.log('Get values directly from mongo failed:'); console.log(e);
          return [];
        }
      } else {
        return [];
      }
    }
  },

};

// This is code to generate the grouping and final projection iin the
// original MongoDB pipeline, as part of the pivoting API.
//
// For very large datasets, the $group operator over a set of categorical
// variables with lots of values does not perform well.  There does not
// appear to be a very performant way to leverage the MongoDB pipeline
// so that it works well, even with indexes set on the categorical variables.
// Instead, we handle it ourselves with a for loop.  See the handler
// for '/api/aggregate/:dataset/:datapoint' below.
//
// We preserve the code here in case we want to revisit grouping in some
// time in the future.
//
const getOldPipeline = () => {

  // Get the $group attributes for each categorical variable value
  //
  const tGroup = Object.keys(catValueMap).map((x) => {
    const alias = metadata.getAlias(x);
    return catValueMap[x].map(value => {

      // This will create a field such as 'Gender:Male'.
      // Note that Mongo doesn't allow '.' in a field name, so
      // this will get a safe alternative.
      //
      // NOTE! NOTE!  This will cause categorical values that
      // contain '.' to CHANGE (using an underscore)!!
      //
      const fqn = getMongoField('' + alias + ':' + value);

      // This will count the number of the categorical variable value
      // appearances for each datapoint (e.g. STATE).
      //
      const counter = {
        $sum: {
          $cond: [
            { $eq: [ '$' + x, { $literal: value } ] }, 1, 0
          ]
        }
      }
      return {[fqn]: counter};
    }).reduce((v1, v2) => ({...v1, ...v2}), {});
  }).reduce((v1, v2) => ({...v1, ...v2}), {});

  // aGroup will look like this:
  // {
  //   _id: {
  //     State: '$STATE',
  //   },
  //   '<numeric-alias>': { $sum: '$<numeric-column>' }, // sums numerics
  //   '<vector-alias>': { $addToSet: '$<vector-column>' },
  //   'Gender:Male': {
  //     $sum: {
  //       $cond: [
  //         { $eq: [ '$GENDER', 'Male' ] }, 1, 0
  //       ]
  //     }
  //   }, ...
  // }
  const datapointObj = getGroupedDatapoint(datapointCol);
  const nGroup = { _id: datapointObj, }

  // $addToSet will create a vector of vectors
  //
  const vGroup = vectors.reduce((i, j) => {
    const alias = metadata.getAlias(j);

    return {...i, ...{[alias]: { $addToSet: '$' + j }}};
  }, {});

  const vProject = vectors.reduce((i, j) => {
    const alias = metadata.getAlias(j);

    return {...i, ...{[alias]: true}};
  }, {});

  const numericSums = numerics.filter(i => {
    return i !== constants.sumrecords;
  }).reduce((i, j) => {
    const alias = metadata.getAlias(j);
    return {...i, ...{[alias]: { $sum: '$' + j }}};
  }, {});

  // Singleton numeric values are not summed; they represent a single
  // value for a particular datapoint.
  //
  const singletonFirsts = singletons.reduce((i, j) => {
    const alias = metadata.getAlias(j);
    return {...i, ...{[alias]: { $first: '$' + j }}};
  }, {});
  
  const cGroup = {[nrecName]: { $sum: 1 }, ...numericSums, ...singletonFirsts};
  const aGroup = {...nGroup, ...cGroup, ...tGroup, ...vGroup};

  // Get the $project attributes for each categorical variable value.
  // tProject is for all of the categorical values.
  //
  // NOTE! NOTE!  This will cause categorical values that
  // contain '.' to CHANGE (using an underscore)!!
  //
  const tProject = Object.keys(catValueMap).map(x => {
    const alias = metadata.getAlias(x);
    return catValueMap[x].map(value => {
      const fqn = getMongoField('' + alias + ':' + value);
      return {[fqn]: true};
    }).reduce((v1, v2) => ({...v1, ...v2}), {});
  }).reduce((v1, v2) => ({...v1, ...v2}), {});

  // cProject is for the "total # of records" field
  //
  // const cProject = {[nrecName]: true, <numeric-alias>: true, ...};

  const numericTrues = numerics.concat(singletons).filter(i => {
    return i !== constants.sumrecords;
  }).reduce((i, j) => {
    const alias = metadata.getAlias(j);
    return {...i, ...{[alias]: true}};
  }, {});
  const cProject = {[nrecName]: true, ...numericTrues};

  // dProject is for the datapoint column
  //
  const dProject = {[groupAlias]: '$_id.' + groupAlias};

  // aProject will look like this:
  // {
  //   _id: false,
  //   'State': '$_id.State',   ... datapoint column and value
  //   'Customers': true,       ... # records count
  //   'Gender:Male': true,     ... All of the categorical pivot counts
  //    ...
  // }
  //
  const aProject = { _id: false, ...dProject, ...cProject, ...tProject, ...vProject };

  // const pipeline = [
    // {$match: match}, 
    // {$project: preProject},
    // {$group: aGroup}, 
    // {$project: aProject}
  // ];
}

// Return data grouped by datapointCol, calculating numeric sums,
// categorical counts, total # of records, and vector set inclusion.
// Needs to be as fast as possible.
//
const getValuesByDatapoint = (datapointCol, data) => {
  const nrecName = metadata.getAlias(constants.sumrecords);
  const numerics = metadata.getAverageableNumerics();
  const singletonsForDatapoint = metadata.getColumnsByAttrValue('singleton', datapointCol);
  const singletonsForAll = metadata.getColumnsByAttrValue('singleton', '');
  const singletons = singletonsForDatapoint.concat(singletonsForAll);

  // FIXME:  use this to support vector retrieval.
  // Use vGroup above as a model, if we want to re-support vectors.
  //
  const vectors = metadata.getVectors();

  const catVars = transforms
    .merge(metadata.getAggregateCategoricals(), metadata.getSearchable())
    .filter(i => i !== datapointCol);

  const catAliases = catVars.reduce((i, j) => {
    return { ...i, ...{[j]: metadata.getAlias(j)} };
  }, {});
  const catKeys = Object.keys(catAliases);
  const catValues = Object.values(catAliases);

  // Also calculate numerics
  //
  const numericAliases = numerics.filter(i => i !== constants.sumrecords).reduce((i, j) => {
    const alias = metadata.getAlias(j);
    return {...i, ...{[j]: alias} };
  }, {});
  const numericKeys = Object.keys(numericAliases);
  const numericValues = Object.values(numericAliases);

  // singletons
  const singletonAliases = singletons.filter(i => i !== constants.sumrecords).reduce((i, j) => {
    const alias = metadata.getAlias(j);
    return {...i, ...{[j]: alias} };
  }, {});
  const singletonKeys = Object.keys(singletonAliases);
  const singletonValues = Object.values(singletonAliases);

  // Avoid functional code here; reduce is too slow for large dataset
  //
  let valuesByDatapoint = {};
  for (let index = 0; index < data.length; ++index) {
    const rec = data[index];
    const datapointValue = rec[datapointCol];
    const prevDatapointObj = valuesByDatapoint.hasOwnProperty(datapointValue) ? valuesByDatapoint[datapointValue] : {};

    for (let catsIndex = 0; catsIndex < catKeys.length; ++catsIndex) {
      const catCol = catKeys[catsIndex];
      const catAlias = catValues[catsIndex];
      const catValue = rec[catCol];
      const aliasWithValue = `${catAlias}:${catValue}`;
      const prevCount = prevDatapointObj.hasOwnProperty(aliasWithValue) ? prevDatapointObj[aliasWithValue] : 0;

      prevDatapointObj[aliasWithValue] = prevCount + 1;
    }

    for (let sumsIndex = 0; sumsIndex < numericKeys.length; ++sumsIndex) {
      const numericCol = numericKeys[sumsIndex];
      const numericAlias = numericValues[sumsIndex];
      const numericValue = +rec[numericCol];
      const prevSum = prevDatapointObj.hasOwnProperty(numericAlias) ? prevDatapointObj[numericAlias] : 0;

      prevDatapointObj[numericAlias] = prevSum + numericValue;
    }

    for (let singletonIndex = 0; singletonIndex < singletonKeys.length; ++singletonIndex) {
      const singletonCol = singletonKeys[singletonIndex];
      const singletonAlias = singletonValues[singletonIndex];
      const singletonValue = rec[singletonCol];
      const prevSingleton = prevDatapointObj.hasOwnProperty(singletonAlias) ? prevDatapointObj[singletonAlias] : null;

      if (prevSingleton === null && singletonValue !== null) {
        prevDatapointObj[singletonAlias] = singletonValue;
      }
    }

    // Add vector set inclusion here.  See use of vGroup in old code above.

    // Add # records
    //
    const prevNrec = prevDatapointObj.hasOwnProperty(nrecName) ? prevDatapointObj[nrecName] : 0;
    prevDatapointObj[nrecName] = prevNrec + 1;

    valuesByDatapoint[datapointValue] = prevDatapointObj;
  }
  return valuesByDatapoint;
}

const endpoint = async () => {
  const connectString = connect;
  console.log('Direct connection to mongo: ' + connectString);
  console.log('Prisma connection to mongo: ' + process.env.DATABASE_URL);

  // Prisma connector, for graphql query support, separate from express.
  //
  await prisma.$connect();

  console.log("endpoint.js RESTful service starting...");

  const app = express();

  const port = 3000;

  // Our httpServer handles incoming requests to our Express app.
  // Below, we tell Apollo Server to "drain" this httpServer,
  // enabling our servers to shut down gracefully.
  //
  const httpServer = http.createServer(app);

  // Same ApolloServer initialization as before, plus the drain plugin
  // for our httpServer.
  //
  const apolloServer = new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
  });

  // Ensure we wait for our apollo server to start
  //
  await apolloServer.start();

  // Specify the path where we'd like to mount our server.
  // Note that we must use /api because it's the proxy root.
  //
  app.use('/api/graphql', cors(), json(), 
      expressMiddleware(apolloServer, {
        context: async ({ req, res }) => {
          return { prisma, connectString };
        },
      })
  );
  
  const q2m = require('query-to-mongo');

  // Given a native field name, return one safe for mongodb fields.
  //
  // NOTE! NOTE!  This will cause categorical values having
  // periods to CHANGE.
  //
  const getMongoField = function(field){
    return field.replace('.', '_');
  }

  // Convert nulls within the 'query'.
  // This stuff is mongo hard :)
  //
  const withNulls = function(query) {

    return Object.keys(query).reduce((i, j) => {
      const values = query[j];

      if (typeof(values)==='object') { // $in: [v1, (null), v2, ... ] ->
                                       // $in: [v1, null, v2, ...]
        if (values.$in) {
          const inOp = values.$in;

          const newFilter = Array.isArray(inOp) ? inOp.map(k => {
            return k === constants.Null ? null : k;
          }) : inOp;

          return {...i, ...{[j]: {$in: newFilter}}};
        } else {
          return {...i, ...j};
        }
      } else {
        const newFilter = Array.isArray(values) ? values.map(k => {
          return k === constants.Null ? null : k;
        }) : (values === constants.Null ? null : values);

        return {...i, ...{[j]: newFilter}};
      }
    }, {});
  }

  // Return static content
  //
  app.use(express.static(path.join(__dirname + "/..")));
  
  // Logging
  //
  app.use(morgan('combined'));

  app.get('/', function(req, res){
    res.sendFile(path.join(__dirname + "./index.html"));
  });

  // List every available dataset.  Return in JSON format.
  //
  app.get('/api/list', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      reader.getDatasets(db).then(function(items){
        res.send(items);
      });
    });
  });

  // Get data for :dataset.  Return is in JSON format.
  // Allow optional ?COLUMN=VALUE... parameters.
  //
  app.get('/api/data/:dataset', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      reader.getData(db, dataset).then(function(data){

        // Apply filter here.  Better is to use the Mongo primitives;
        // using e.g. query-to-mongo package.
        // See the /query getter below.
        //
        const rows = data.filter(function(x){
          return Object.keys(req.query).every(function(y){  // for all keys
            if (x.hasOwnProperty(y)) {
              const value = req.query[y];
              if (Array.isArray(value)) {
                return value.includes(x[y]);  // there exists matching value
              } else {
                return x[y]===value;
              }
            } else {
              return true;  // Missing column considered OK
            }
          });
        });
        res.send(rows);
      });
    });
  });

  // This one gets data, but uses query-to-mongo for the retrieval,
  // utilizing fast Mongo primitives.
  // Example queries:
  //   /query/test10?ZIP>50000
  //   /query/test10?GENDER=Female
  //   /query/test10?RACE=Asian&RACE=White
  //   /query/test10?RACE=Asian,White          ... same as previous
  //   /query/test10?RACE=Asian&limit=5        ... for paging
  //
  app.get('/api/query/:dataset', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      const query = q2m(req.query);
      reader.getDataWithQuery(db, dataset, query)
        .then(function(data){
          res.send(data);
        });
    });
  });

  // Get the Mongo result, but run the result through our custom
  // pivot transform, rather than through the mongo aggregation
  // pipeline.
  //
  app.get('/api/pivot/:dataset', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      const query = q2m(req.query);
      reader.getDataWithQuery(db, dataset, query)
        .then(function(data){
          const datapointCol = datapoint.getDefaultDatapointCol();
          const pivoted = transforms.reducer(
              transforms.mapper({}, datapointCol, 'None', data));
          res.send(pivoted);
        });
    });
  });

  // Like the above, but allow the user to pass in a different 
  // graphtype and datapoint column.
  //
  app.get('/api/pivot/:dataset/:graphtype/:datapoint', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      const query = q2m(req.query);
      reader.getDataWithQuery(db, dataset, query)
        .then(function(data){
          const xform = transforms.getTransformedData(req.params.graphtype,
              {}, req.params.datapoint, 'None', constants.d3geom, data);
          res.send(xform);
        });
    });
  });

  // Do pivot, using aggregation pipeline
  //
  app.get('/api/aggregate/:dataset/:datapoint', async (req, res) => {
    try {
      const client = await reader.connect(connectString);
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      // First, get the vector of values for each categorical variable.
      //
      const datapointCol = req.params.datapoint;
      const datapointAlias = metadata.getAlias(datapointCol);

      // We can use q2m to generate a $match-ready query, in the 'criteria'
      // field.
      //
      const outerMatch = (Object.getOwnPropertyNames(req.query).length===0)
        ? {}
        : q2m(req.query);
      const match1 = outerMatch.criteria || {};
      const match = withNulls(match1);

      // Return the group name associated with datapointCol.  If 'useAlias'
      // is true, the returned name is the external (alias) name
      //
      const getGroupName = (datapointCol, useAlias) => {
        const name = useAlias? metadata.getAlias(datapointCol) : 
            datapointCol;
        const binner = metadata.getBinner(datapointCol);
        return (binner === 'byMonth')? '' + name + ':month' : '' + name;
      }

      // Return an object used to create a datapoint alias that might
      // be grouped (e.g. by date).
      //
      const getGroupedDatapoint = datapointCol => {
        const groupAlias = getGroupName(datapointCol, /* useAlias */ true);
        const groupCol = getGroupName(datapointCol, /* useAlias */ false);
        return {[groupAlias]: '$' + groupCol};
      }

      // Return the "identity projection"
      //
      const getIdentityProject = columns => {
        const ip = columns.reduce((v1, v2) => ({...v1, ...{[v2]: true}}), {});
        return {_id: true, ...ip};
      }

      // "Pre" $project: Create a calculated field that is the binned
      // value of the datapoint column.  (If the datapoint column doesn't
      // have a binned value, this will do nothing.)  The binned value
      // for a month is the 1st day of that month.
      //
      const getPreProject = (datapointCol, identity) => {
        const binner = metadata.getBinner(datapointCol);
        if (binner==='byMonth') {
          const groupName = getGroupName(datapointCol, /* useAlias */ false);
          const monthlyValue = {
            $concat: [
              { $arrayElemAt: [ { $split: 
                  [ '$' + datapointCol, '/' ] }, 0 ] },
              '/01/',
              { $arrayElemAt: [ { $split: 
                  [ '$' + datapointCol, '/' ] }, 2 ] },
            ]
          };
          return {...identity, ...{[groupName]: monthlyValue}};
        } else {
          return identity;
        }
      }
      const groupAlias = getGroupName(datapointCol, /* useAlias */ true);

      const allNonCalculatedCols = metadata.getAllNonCalculated();

      const ip = getIdentityProject(allNonCalculatedCols);
      const preProject = getPreProject(datapointCol, ip);

      // A previous version of this pipeline added a $group and a final $project.
      // But the $group doesn't perform well when creating distributions of
      // categorical variables by group.  We calculate the distributions ourselves,
      // using a for loop below.
      //
      const pipelineNew = [
        {$match: match}, 
        {$project: preProject},
      ];
      const data = await reader.getPivotedData(db, req.params.dataset, pipelineNew);

      // Calculate the distribution of all categorical values in Javascript,
      // not in mongodb pipeline.  The pipeline is just plain slow for this; we can
      // do it faster.
      //
      const valuesByDatapoint = getValuesByDatapoint(datapointCol, data);

      const withValuesByDatapoint = Object.keys(valuesByDatapoint).map(i => {
        const rec = valuesByDatapoint[i];
        return { [datapointAlias]: i, ...rec };
      });

      // Post-process: Remove all categorical variable
      // values whose count is zero.  These don't add any information,
      // and the result set is sparse, so this shrinks the result
      // set a lot.
      //
      // Update 5/2023: Because we are no longer using agg pipeline $group,
      // no need for the above check.
      //
      // Also, add an id field for last-ditch animation constancy.
      //
      // And modify grouped datapoint variables to be consistent 
      // with legacy names (e.g. don't use 'Gain Date:month', use
      // 'Gain Date'; and don't send mm/01/YYYY date, send the epoch MS).
      // FIXME: Adjust app so it allows 'Gain Date:month' = '05/01/2011'.
      //
      const final = withValuesByDatapoint.map((row, i) => {
        return Object.keys(row).map(key => {

          if (key === groupAlias && groupAlias !== datapointAlias) {

            // e.g. 05/01/2011 -> 1430452800000
            //
            const epoch = +new Date(row[key]);  

            return {[datapointAlias]: epoch};
          } else {
            return {[key]: row[key]};
          }
        }).reduce((v0, v1) => { return {...v0, ...v1, id: i} }, {});
      });
      res.send(final);
    } catch (e) {
      console.log('Pivot failed: '); console.log(e);
    }
  });

  // Return the distinct values of ':column' within ':dataset'
  //
  app.get('/api/values/:dataset/:column', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      reader.getCategoricalValues(db, dataset,
          req.params.column).then(function(values){
        res.send(values);
      });
    });
  });

  // Return distinct values of every column of the given :type
  // No longer used; using the nicer async/await below.
  //
  app.get('/api/v0/allvalues/:dataset/:type', function(req, res){
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      const catVars = metadata.getColumnsByAttrValue('type', 
          req.params.type);
      const promises = catVars.map(function(x){
        return reader.getCategoricalValues(db, dataset, x);
      });
      Promise.all(promises).then(function(values){
        const catValueMap = catVars.map(function(x, i){
          return {[x]: values[i]};
        }).reduce((v0, v1) => {return {...v0, ...v1}}, {});
        res.send(catValueMap);
      });
    });
  });

  app.get('/api/allvalues/:dataset/:type', async (req, res) => {
    const client = await reader.connect(connectString);

    // Since this is typically the first API call, we'll check the
    // database name list to make sure 'database' is in there.
    //
    const adminClient = client.db().admin();
    const dbInfo = await adminClient.listDatabases();
    const databases = dbInfo?.databases;
    const exists = Array.isArray(databases) && !!databases.find(i => i.name === database);
    if (!exists) {
      console.error(`Database ${database} does not exist!`);
      return;
    }

    const db = client.db(database);
    const dataset = req.params.dataset;
    metadata.setMetadata(dataset);

    const catVars = metadata.getColumnsByAttrValue('type', 
        req.params.type);
    const promises = catVars.map(function(x){
      return reader.getCategoricalValues(db, dataset, x);
    });
    const values = await Promise.all(promises);
    const catValueMap = catVars.map(function(x, i){
      return {[x]: values[i]};
    }).reduce((v0, v1) => {return {...v0, ...v1}}, {});
    res.send(catValueMap);
  });

  // Return rows where column :name has the given :value
  //
  app.get('/api/data/:dataset/:name/:value', function(req, res){
    const col = req.params.name;
    const value = req.params.value;
    reader.connect(connectString).then(function(client){
      const db = client.db(database);
      const dataset = req.params.dataset;
      metadata.setMetadata(dataset);

      reader.getData(db, dataset).then(function(data){
        const rows = data.filter(function(x){
          return x.hasOwnProperty(col) && x[col]===value;
        });
        res.send(rows);
      });
    });
  });

  app.set('port', port);
  app.listen(port, function(){
    console.log("Listening for connections on port: " + port);
  });
}

endpoint().then(async () => {
  // await prisma.$disconnect();  // careful...this can cause premature disconnection
  console.log('Started endpoint');
});

export default endpoint;
