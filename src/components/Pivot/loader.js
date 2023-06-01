// mongodb app to load CSV data
//
/* eslint-disable no-console */
//
import metadata from './metadata';
import fs from 'fs';
import csv from 'csvtojson';
import { MongoClient } from 'mongodb';
import { connect as conn } from './env';

const loader = function(){

  console.debug = console.log;

  // Load the CSV data in 'next'.  When done, see if there are more to
  // load, and if so, do that recursively.
  //
  const loadNext = function(next, remainder, folder, db, collectionMap){
    if( next ){
      const dataset = next.split('.')[0];
      const location = folder + '/' + next;
      load(location, dataset, db, collectionMap, function(dataset){
        if( remainder.length>0 ){
          loadNext(remainder[0], remainder.slice(1), folder, db, collectionMap);
          console.log("Loaded " + dataset + " from " + location);
        } else {
          console.log("   All CSV files are loaded.");
          process.exit(0);
        }
      });
    }
  }

  // Load 'dataset' into mongo 'db', creating a collection
  // with the same name as the dataset.  Call 'cb' when the
  // loading finishes
  //
  const load = async function(location, dataset, db, collectionMap, cb){
    metadata.setMetadata(dataset);
    const numerics = metadata.getNumerics();

    // Make sure that csvtojson doesn't convert numbers to strings
    //
    const colParser = numerics.reduce((i, j) => {
      return {...i, ...{[j]: 'number'}};
    }, {});

    // Remove the entire collection
    //
    if (collectionMap.hasOwnProperty(dataset)) {
      db.collection(dataset).drop();
    }
    const collection = db.collection(dataset);
    const rawData = await csv({colParser}).fromFile(location);
    console.log("Loading " + dataset + ".  input #rec=" + rawData.length);
    const result = await collection.insertMany(rawData);
    console.log('Loaded ' + dataset);
    cb && cb(dataset, rawData);
  }

  // This will connect to the mongodb listener
  //
  const connect = async function(connectString){
    const client = new MongoClient(connectString);
    try {
      await client.connect();
      const db = client.db();
      const collections = await db.listCollections({}, { nameOnly: true }).toArray();

      const collectionMap = collections.reduce((i, j) => {
        return {...i, ...{[j.name]: true}};
      }, {});

      // Load each .csv file
      //
      const folder = '../../../src/static/data';
      fs.readdir(folder, function(err, files){
        const csvFiles = files
           .filter(i => (i.split('.')[1] === 'csv'))
           .filter(i => !i.startsWith('201') && !i.startsWith('202'));
        if (csvFiles.length > 0) {
          loadNext(csvFiles[0], csvFiles.slice(1), folder, db, collectionMap);
        }
      });
    } catch(e) {
      console.log('FAILED: error='); console.log(e);
    } finally {
      // Do not do this here; it will prematurely close db
      // await client.close();
    }
  }

  return {
    connect
  }
}();

// const connectString = "mongodb://localhost:27017/pivotDb";
console.log('Connecting to mongo using: ' + conn);
loader.connect(conn);
