// Turning off eslint warnings:
/* global d3 */
//
import metadata from './metadata';
import datapoint from './datapoint';
import transforms from './transforms';
import utils from './utils';
import constants from './constants';

import axios from 'axios';

const dataread = function() {

  // Read a dataset.
  //
  // 'cmd' is either 'csv', 'all' or 'increment'.  If it's
  // 'csv', do a csv read.  If it's 'all', it's a full Mongo read
  // that returns categorical values.  If it's 'increment', it's
  // a Mongo read that just returns pivoted data.
  //
  // If rawData is provided, use it directly.  This is used when
  // a 3rd party sends the component data.
  //
  const readDataset = function(cmd, dataset, filter, loadTable, datapointCol,
      graphtype, animationCol, rawData) {

    // If we're reading from mongodb, start a mongodb RESTful session.
    // We consider that we're reading from a CSV file if the chosen 
    // dataset's name ends in '.csv'.
    //
    if (dataset && !metadata.metadataExists(dataset)) {
      return new Promise((resolve, reject)  => {
        reject(`Dataset "${dataset}" does not exist`);
      });
    } else if (rawData) {
      return rawDataToProcessed(filter, loadTable,
          datapointCol, graphtype, animationCol, rawData);
    } else if (cmd === 'csv') {
      return readCSVOrJsonData(dataset)
        .then(getCategoricalValues)
        .then(csvRawToProcessed(filter, loadTable,
                                datapointCol, graphtype, animationCol));
    } else if (cmd === 'all') {
      return mongoReadDataset(dataset, datapointCol, filter)
        .then(mongoPivotedToProcessed(loadTable, datapointCol));
    } else { // cmd === 'increment'
      return mongoGetTransformedData(dataset, datapointCol, filter, graphtype)
        .then(mongoPivotedToProcessed(loadTable, datapointCol));
    }
  }

  // This is used when data is supplied from a 3rd party.
  // Returns a Promise so its type aligns with the other
  // data accessors.
  //
  const rawDataToProcessed = (filter, loadTable, datapointCol,
      graphtype, animationCol, unsafeRawData) => {
    return new Promise((resolve, reject) => {
      const { categoricalValues, rawData } = getCategoricalValues(unsafeRawData);

      const xform = transforms.getTransformedData(graphtype,
          filter, datapointCol, animationCol,
          constants.d3geom, rawData);
      const pivotedData = xform.data;
      const processedData = process(pivotedData, loadTable, datapointCol);
   
      resolve({categoricalValues, pivotedData, processedData});
    });
  }

  // Given a (possibly null) set of raw values, return an object
  // with the categorical values.  The raw data will be coerced to []
  // on the output if it isn't an array on input.
  //
  const getCategoricalValues = unsafeRawData => {
    const rawData = Array.isArray(unsafeRawData) ? unsafeRawData : [];
    const categoricalValues = utils.getAllUniqueValues(rawData, getCatColumns());
    return {rawData, categoricalValues};
  }

  const getCatColumns = () => {
    const catColumns = metadata.getColumnsByAttrValue('type', 'Categorical');
    const dateColumns = metadata.getColumnsByAttrValue('type', 'IsoDate');
    return catColumns.concat(dateColumns);
  }
  
  const csvRawToProcessed = (filter, loadTable, datapointCol,
      graphtype, animationCol) => res => {
    const {categoricalValues, rawData } = res;
    const xform = transforms.getTransformedData(graphtype,
        filter, datapointCol, animationCol,
        constants.d3geom, rawData);
    const pivotedData = xform.data;
    const processedData = process(pivotedData, loadTable, datapointCol);

    return { categoricalValues, pivotedData, processedData };
  }

  const mongoPivotedToProcessed = (loadTable, datapointCol) => res => {
    const categoricalValues = res.categoricalValues || {};
    const pivotedData = res.pivotedData || [];
    const processedData = process(pivotedData, loadTable, datapointCol);
    return { categoricalValues, pivotedData, processedData };
  }

  // Read the CSV data.
  // Returns a promise that is resolved with the raw CSV data.
  //
  const readCSVOrJsonData = function(dataset) {
    return new Promise((resolve, reject) => {
      const url = constants.dataFolder + '/' + dataset;
      if (utils.isCSV(dataset)) {
        d3.csv(url, resolve);
      } else {
        d3.json(url, resolve);
      }
    });
  }

  // Post-process data by adding average values for all Numeric columns
  //
  const withAverages = function (data) {
    if (!Array.isArray(data)) {
      return null;
    }
    const nrec = metadata.getAlias(constants.sumrecords);
    const numericAliases = metadata.getAverageableNumerics().filter(i => {
      return i !== constants.sumrecords;
    }).map(i => {
      return metadata.getAlias(i);
    });

    return data.map(i => {
      const denominator = i.hasOwnProperty(nrec) ? +i[nrec] : null;
      const averages = denominator ? numericAliases.reduce((j, k) => {
        const numerator = i.hasOwnProperty(k) ? +i[k] : null;
        const avg = numerator !== null && denominator !== null ? numerator / denominator : null;
        const nvPair = {[k + constants.avgSuffix]: avg};
        
        return {...j, ...nvPair};
      }, {}) : {};

      return {...i, ...averages};
    });
  }

  // Post-process data by counting categorical variable names
  // (not their values).
  //
  const withCategoricalCounts = data => {
    if (!Array.isArray(data)) {
      return null;
    }
    const catVarMap = metadata.getCategoricals().reduce((i, j) => {
      return {...i, ...{[metadata.getAlias(j)]: true}};
    }, {});
    const catValueMap = metadata.getCategoricals().filter(i => {
      return metadata.isTrue(i, 'summaryValues');
    }).reduce((i, j) => {
      return {...i, ...{[metadata.getAlias(j)]: true}};
    }, {});

    return data.map(i => {
      const sums = Object.keys(i).filter(j => {
        const catVarName = j.substring(0, j.indexOf(':'));
        return catVarMap.hasOwnProperty(catVarName);
      }).reduce((j, k) => {
        const catVarName = k.substring(0, k.indexOf(':'));
        const numName = `# ${catVarName}`;
        const prev = j.hasOwnProperty(numName) ? j[numName] : 0;
        return {...j, [numName]: prev + 1};
      }, {});
      return {...i, ...sums};
    });
  }

  // Calculate the values for fields with metadata tag 'calculated'.
  // We call metadata tag 'transform' with arguments in metadata tag 'fields'.
  //
  // Note that we always append the entire dataset to the calculation function,
  // in case it needs to do a calculation (like deciles) that requires all
  // records.
  //
  // Also note that we only calculate fields that pass the 'isAllowedForDatapoint'
  // test.
  //
  const withCalculatedFields = datapointCol => data => {
    const calcMeta = 'calculated';

    // First, get the calculated columns that don't use the preTransform.
    // We'll use these to do a first pass over the data, generating the
    // first set of calculated columns.
    //
    const calcColumns1 = metadata.getColumnsWithAttr(calcMeta).filter(i => {
      const value = metadata.getAttrValue(i, calcMeta);
      return !value.hasOwnProperty('preTransform') && 
          metadata.isAllowedForDatapoint(datapointCol, i);
    }).map(i => {
      const alias = metadata.getAlias(i);
      const value = metadata.getAttrValue(i, calcMeta);
      const { fields, transform } = value;
      const idx = value.idx || 0;
      return { alias, fields, transform, transformedData: data, idx };
    }).sort((i, j) => {
      return i.idx - j.idx;
    });

    const pass1 = applyCalculations(data, calcColumns1);

    // Now look for the calculated columns that contain preTransform.
    // This is typically a sorting operation, e.g. if we're calculating deciles.
    // This had to wait until we've done the first set of calculations above,
    // because the following may use calculated columns as inputs.
    //
    const calcColumns2 = metadata.getColumnsWithAttr(calcMeta).filter(i => {
      const value = metadata.getAttrValue(i, calcMeta);
      return value.hasOwnProperty('preTransform') &&
          metadata.isAllowedForDatapoint(datapointCol, i);
    }).map(i => {
      const alias = metadata.getAlias(i);
      const value = metadata.getAttrValue(i, calcMeta);
      const { fields, transform, preTransform } = value;
      const idx = value.idx || 0;
      const aliases = Array.isArray(fields) ? fields.map(l => {
        return metadata.getAlias(l);
      }) : [];
      const args = [pass1].concat(aliases);
      const transformedData = preTransform
          ? preTransform.apply(this, args)
          : null;
      return { alias, fields, transform, transformedData, idx };
    }).sort((i, j) => {
      return i.idx - j.idx;
    });

    return applyCalculations(pass1, calcColumns2);
  }
  
  // Convert formats for values for all fields where 'useFormat' is true.
  // (The 'format' field would otherwise only be applied for tooltips
  // and facet search fields).
  //
  const withFormats = function(data) {
    const useFormatFields = metadata.getColumnsWithAttr('useFormat');
    return data.map(i => {
      const formatted = useFormatFields.reduce((j, k) => {
        const value = i[k];
        const fmtValue = metadata.getFormattedValue(k, value);
        return {...j, ...{[k]: fmtValue}};
      }, {});
      return {...i, ...formatted};
    });
  }

  // Apply calculations to 'data', given the set of calcColumns.
  //
  const applyCalculations = function(data, calcColumns) {
    // Note how the calculation accumulates via reducer that takes the
    // updated row as input to the next calculation.  This allows us
    // to make per-row calculations that are based on prior calculations
    // within that same row, as well as from the previously calculated
    // row.
    //
    const calcAliases = calcColumns.map(i => {
      const { fields } = i;
      const aliases = Array.isArray(fields) ? fields.map(m => {
        return metadata.getAlias(m);
      }) : [];
      return {...i, aliases};
    }, {});

    const accumData = data.reduce((i, j) => {
      const calculations = calcAliases.reduce((k, l) => {
        const { alias, aliases, transform, transformedData } = l;

        // Pass these arguments to the calculated field transform:
        // - The current record (k)
        // - The list of field names that are inputs to the transform (aliases)
        // - The entire dataset, possibly transformed
        // - The previously calculated record (used for accumulating)
        //
        const args = [k].concat(aliases).concat([transformedData]).concat([i.prev]);
        try {
          const res = transform ? transform.apply(this, args) : null;
          return {...k, ...{[alias]: res}};
        } catch (e) {
          console.error('transform FAIL, err=' + e);
          return {...k, ...{[alias]: null}};
        }

      }, j);

      const prev = {...j, ...calculations};
      const output = i.output.concat(prev);

      return {output, prev};
    }, {output: [], prev: {}});

    return accumData.output;
  }

  // Return data after any preprocessing.
  //
  // We use the loadTable, if there is any, to generate fractional
  // outputs based on how the load of any categorical value affects
  // the numeric specified in the 'whatIfTarget' metadata.
  //
  const preprocess = function(data, loadTable){
    const tableMap = metadata.getReverseMap('whatIfTarget');
    const targetTable = getTargetTable(loadTable, tableMap);

    if (targetTable !== null) {
      const res = data.map(i => {

        const changes = Object.keys(targetTable).reduce((j, k) => {
          const fractionOfTotal = getFractionOfTotal(k, j);
          const loadChanges = targetTable[k];

          const newValues = loadChanges.reduce((l, m) => {
            const loadFraction = m.value / 100;
            const oldValue = i.hasOwnProperty(m.name) ? +j[m.name] : 0;
            const unchangedPart = oldValue * (1 - fractionOfTotal);
            const changedPart = oldValue * fractionOfTotal * loadFraction;
            const newValue = unchangedPart + changedPart;

            return {...l, ...{[m.name]: newValue}};
          }, {});

          return {...j, ...newValues};

        }, i);

        return {...i, ...changes};
      });
      return res;
    } else {
      return data;
    }
  }

  // Perform a "dataset transform".
  //
  // In metadata, there may be a 'transform' field in the dataset.  This allows us
  // to create a "synthetic dataset" based on an existing dataset.  This is
  // how we might convert an entity-based dataset into a time-series dataset,
  // for example.  See aisTimeMetadata.
  //
  const getDatasetTransform = function(data) {
    const datasetTransform = metadata.getDatasetAttr('transform');
    const transformFields = metadata.getDatasetAttr('transformFields');
    const numericMap = metadata.getNumerics().reduce((i, j) => {
      const typeObj = {
        subtype: metadata.getAttrValue(j, 'subtype', null),
        calculated: metadata.getAttrValue(j, 'calculated', null)
      };
      return {...i, ...{[j]: typeObj}};
    }, {});
    const aliasMap = metadata.getAll().reduce((i, j) => {
      return {...i, ...{[j]: metadata.getAlias(j)}};
    }, {});
    if (datasetTransform && transformFields) {
      const aliases = Array.isArray(transformFields) ? transformFields.map(l => {
        return metadata.getAlias(l);
      }) : [];

      const args = aliases.concat([data]).concat([aliasMap]).concat([numericMap]);
      return datasetTransform.apply(this, args);
    } else {
      return data;
    }
  }

  // Given a loadTable of the form
  //   [ { value: CAT-VALUE, header-name-1: LOAD-VALUE, ... }, ...]
  // and a tableMap of the form {table-map-name: [column, ...], ...}
  // return a loadTable that contains aliased names of the targets of
  // the load changes, instead of header names.
  //
  const getTargetTable = function(loadTable, tableMap) {
    if (!loadTable || !tableMap) return null;

    return loadTable.reduce((i, j) => {
      const key = j.value;

      const vector = [].concat.apply([], Object.keys(j).filter(k => {
        return k !== 'value';
      }).map(k => {
        const innerVector = tableMap.hasOwnProperty(k) ? tableMap[k] : [];

        return innerVector.map(l => {
          const alias = metadata.getAlias(l);
          return {name: alias, value: j[k]};
        });
      }));

      return {...i, ...{[key]: vector}};
    }, {});
  }

  // Given a 'catValue' within a 'row' representing an aggregation of data,
  // return the percentage that 'catValue' has of the entire aggregation.
  //
  // We do this so that we'll know what the impact of changing the value
  // of 'catValue' is.
  //
  const getFractionOfTotal = function(catValue, row) {
    // First, handle the "general improvement" case, where we assume that
    // the catValue always matches the entire row.
    //
    if (catValue === constants.generalImprovement) {
      return 1;
    }

    const thisValue = row.hasOwnProperty(catValue) ? +row[catValue] : 0;
    const alias = catValue.split(':')[0];

    // Divide this into two cases:
    // - we are aggregating by the catValue's variable, in which case either
    //   the row represents the entire catValue, or none of it; or
    // - we aren't aggregating by the catValue's variable, in which case we
    //   have to determine the fraction of the aggregation representing catValue.
    //
    if (row.hasOwnProperty(alias)) {
      const catValueName = catValue.split(':')[1];

      return row[alias] === catValueName ? 1 : 0;
    } else {
      const totalValue = Object.keys(row).filter(i => {
        return i.split(':')[0] === alias;
      }).reduce((i, j) => {
        return i + utils.safeVal(row, j);
      }, 0);

      return totalValue === 0 ? 0 : thisValue / totalValue;
    }
  }

  // Convert incoming DateString columns into output columns with a Date in
  // milliseconds.  This is the format that is now used for date conversions.
  //
  // Uses the metadata attribute 'output' to identify the newly created date-in-ms column.
  //
  const withDates = function(data){
    const dateStringCols = metadata.getColumnsByAttrValue('type', 'DateString');
    const dateStringAliases = dateStringCols.map(metadata.getAlias);

    const outputAliases = dateStringCols.reduce((i, j) => {
      const inputAlias = metadata.getAlias(j);
      const outputCol = metadata.getAttrValue(j, 'output');
      return (outputCol && outputCol !== '')
        ? {...i, ...{[inputAlias]
        : metadata.getAlias(outputCol)}} : i;
    }, {});

    const res = data.map(i => {
      const dateValues = dateStringAliases.reduce((j, k) => {
        if (i.hasOwnProperty(k)) {
          const value = i[k];

          // Allow DateString to be MM/DD/YYYY or MM/YYYY
          //
          const fullDate = toFullDate(value);  
          const epoch = +new Date(fullDate);
          const outputAlias = outputAliases.hasOwnProperty(k) ? outputAliases[k] : k;
          return {...j, [outputAlias]: epoch };
       } else {
         return j;
       }
      }, {});

      return {...i, ...dateValues};
    });
    return res;
  }

  // Convert date of the form MM/YYYY to MM/DD/YYYY.
  // If date is not in that format, just return the value unchanged.
  //
  const toFullDate = value => {
    const comps = value.split('/');
    return comps.length === 2 ? `${comps[0]}/1/${comps[1]}` : value;
  }

  const process = function(data, loadTable, datapointCol) {
    const calculator = withCalculatedFields(datapointCol);
    const res = utils.Identity(preprocess(data, loadTable))
      .map(withDates)
      .map(withAverages)
      .map(withCategoricalCounts)
      .map(getDatasetTransform)
      .map(withFormats)
      .chain(calculator);
    return res;
  }

  // Use mongodb services to retrieve data.
  // Returns a Promise.
  //
  // Returns all categorical and DateString values, since those are likely
  // to be put into a faceted search.
  //
  const mongoReadDataset = async function(dataset, datapointCol, filter){
    if (datapointCol === null){
      return new Promise((resolve, reject) => {
        reject({error: 'There was no default datapoint col specified'});
      });
    }

    const query = getQueryString(filter);

    const encodedDataset = encodeURIComponent(dataset);

    // We no longer use url1 and url2; instead we use a single graphql query
    //
    const url1 = '/api/allvalues/' + encodedDataset + '/Categorical';
    const url2 = '/api/allvalues/' + encodedDataset + '/DateString';
    const url3 = '/api/aggregate/' + encodedDataset + '/' + encodeURIComponent(datapointCol) + '?' + query;

    // Construct a graphql query to simulate url1 and url2.
    // Note that values does NOT use Primsa,
    // until we can figure out how to make the primsa fetch much faster.
    //
    const headers = {
      "content-type": "application/json",
    };
    const valueQuery = `
      query fetchCategoricalValues {
        datasets (name: "${encodeURIComponent(dataset)}") {
          name
          columns (types: ["Categorical"], subtypes: ["Series"]) {
            name
            type
            subtype
            values
          }
        }
      }
    `;
    const data = { query: valueQuery };
    const graphqlUrl = '/api/graphql';
    const graphqlConfig = { url: graphqlUrl, method: 'post', headers, data, };

    try {
      const graphqlResponse = await axios(graphqlConfig);
      const { cats, dates } = convertGraphqlResponse(graphqlResponse);

      // pivoted API is (currently) slow, so we do it last
      //
      if (cats.status === 200 && dates.status === 200 && cats.data && dates.data) {
        const pivoted = await axios.get(url3);
        if (pivoted.status === 200 && Array.isArray(pivoted.data)) {
          return {categoricalValues: {...cats.data, ...dates.data}, pivotedData: pivoted.data};
        } else {
          return {error: 'Failed reading pivoted data'};
        }
      } else {
        return {error: 'Failed reading categorical values'};
      }
    } catch(e) {
      console.log('read failed: error='); console.log(e);
      return {error: 'Failed reading categorical values'};
    }
  }

  // Convert graphql value response into legacy API response.
  // Needed because graphql has an opinion about the API response format that
  // is more stringent than our original endpoint.js REST format.
  //
  const convertGraphqlResponse = response => {
    const columns = response.data && response.data.data && 
        Array.isArray(response.data.data.datasets) && response.data.data.datasets.length > 0 &&
        Array.isArray(response.data.data.datasets[0].columns) &&
        response.data.data.datasets[0].columns.length > 0
      ? response.data.data.datasets[0].columns
      : []; 
     const dataReducer = (i, j) => {
       const {name, values} = j;
       return (name && Array.isArray(values))
         ? { ...i, ...{[name]: values} }
         : i;
     }

     const catsData = columns.filter(i => i.type === 'Categorical').reduce(dataReducer, {});
     const datesData = columns.filter(i => i.type === 'DateString').reduce(dataReducer, {});

     const cats = { ...response, data: catsData };
     const dates = { ...response, data: datesData };
     return { cats, dates };
  }

  // Similar to the above, but used when the user changes the
  // aggregation column.
  //
  const mongoGetTransformedData = function(dataset, datapointCol, filter,
      graphtype){

    // Convert 'filter' into a REST query string
    //
    const query = getQueryString(filter);

    // For force graphs, we handle the map/reduce in the browser.
    // For other graphs, let mongo do all of the work.
    //
    const url = (graphtype==="force" || graphtype==="forceStatus")
      ? '/api/pivot/' + encodeURIComponent(dataset) +
        '/' + encodeURIComponent(graphtype) +
        '/' + encodeURIComponent(datapointCol) +
        '?' + query
      : '/api/aggregate/' + encodeURIComponent(dataset) +
        '/' + encodeURIComponent(datapointCol) + '?' + query;

    const handle = res => {
      const pivotedData = res.status === 200 && Array.isArray(res.data)
        ? res.data : [];
      const facetData = res.status === 200 && Array.isArray(res.facetData)
        ? res.facetData : [];
      return {pivotedData, facetData};
    }

    return axios.get(url)
      .then(handle)
      .catch(error => ({pivotedData: [], facetData: []}));
  }

  // Convert 'filter' into a RESTful query string
  //
  const getQueryString = function(filter) {
    return [].concat.apply([], Object.keys(filter).map(i => {
      return filter[i].map(j => `${i}=${j}`);
    })).join('&');
  }

  return {
    readDataset
  };
}();

export default dataread;
