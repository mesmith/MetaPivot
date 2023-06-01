import metadata from './metadata';
import csv from 'csvtojson';
import XLSX from 'xlsx';
import XLSXstyle from 'xlsx-style';
import fs from 'fs';
import moment from 'moment';
const fastcsv = require('fast-csv');

export const root = '../../../src/static/data';

// Read a single Excel file.  Return a promise resolved with the table of rows.
//
export const readOneXlsx = (dataset, metadata) => {
  const location = root + '/' + dataset + '.xlsx';
  // console.log('Reading Excel file: ' + location + '...');

  try {
    const workbook = XLSX.readFile(location);
    const sheetName = metadata && metadata.sheetName || 'Sheet1';
    const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {raw: false});
    const parsedData = parseXlsxData(data, metadata);
    console.log('  Read OK for Excel file: ' + location + ', # records=' + parsedData.length);
    return Promise.resolve(parsedData);
  } catch (error) {
    console.log('  Read FAILED for Excel file: ' + location + ', error=' + error);
    return Promise.reject(error);
  }
}

// styleSpec allows us to find the color of a cell
//
export const writeOneXlsx = (dataset, metadata, data, styleSpec) => {
  const location = root + '/' + dataset + '.xlsx';
  // console.log('Writing Excel file: ' + location + '...');
  const header = metadata.schema.map(i => i.name);
  const worksheet = XLSX.utils.json_to_sheet(data, { header });

  const styledCol = styleSpec && styleSpec.col ? styleSpec.col : null;
  const styledRule = styleSpec && styleSpec.rule !== null ? styleSpec.rule : null;
  const headerColor = styleSpec && styleSpec.headerColor !== null ? styleSpec.headerColor : null;
  const headerBold = styleSpec && styleSpec.headerBold !== null ? styleSpec.headerBold : false;
  const headerWidths = styleSpec && styleSpec.headerWidths ? styleSpec.headerWidths : [];

  const styledWsCol = styledCol && styledRule ? getWsCol(styledCol, worksheet) : null;

  // Identify the spreadsheet cells whose styles we want to change, and
  // change them based on the rule in styledRule().
  // EXTREME HACK.
  //
  const worksheetHack = styleSpec ? Object.keys(worksheet).reduce((i, j) => {
    const rec = worksheet[j];
    const val = rec.v;
    const row = new String(j.match(/\d+/));
    const col = new String(j.match(/\D/)).toUpperCase();

    // Regexp return strings that have to be coerced in order to compare them, apparently.
    // 
    const color = styledRule !== null && styledWsCol && col === styledWsCol.toUpperCase()
      ? styledRule(val)
      : null; 
    
    const isHeader = Number(row) === 1;
    const hColor = isHeader && headerColor ? headerColor : null;
    const outColor = hColor || color;

    const fill = outColor ? { fill: { fgColor: { rgb: outColor } } } : {};
    const font = isHeader && headerBold ? { font: { bold: true }} : {};
    const style = outColor || isHeader ? { s: { ...fill, ...font } } : {};

    return j[0] === '!'
      ? {...i, ...{[j]: rec}}
      : {...i, ...{[j]: {...rec, ...style}}};
  }, {}) : worksheet;

  const widths = headerWidths.map(i => {
    return { wch: i };
  });

  worksheetHack['!cols'] = widths;

  // Row heights might work in the future; right now nothing happens
  //
  // worksheetHack['!rows'] = [ { hpt: 40 }, ];

  // Freezing doesn't seem to work either.
  //
  // worksheetHack['!freeze'] = { xSplit: '1', ySplit: '1', topLeftCell: 'B2', activePane: 'bottomRight', state: 'frozen' };
  // worksheetHack['!viewPane'] = { state: 'frozen', xSplit: 0, ySplit: 1 };

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheetHack, metadata.sheetName);

  // Only XLSXstyle supports cell coloring, so use it to actually write the Excel.
  //
  XLSXstyle.writeFile(workbook, location);
  console.log('  Wrote Excel file: ' + location + ', # output records=' + data.length);
}

const getWsCol = (colName, ws) => {
  const cell = Object.keys(ws).filter(i => {
    const row = i.match(/\d+/);
    const col = i.match(/\D/);
    const val = ws[i].v;
    return Number(row) === 1 && ws[i].v === colName;
  });

  return cell.length > 0 ? new String(cell[0].match(/\D/)) : null;
}

// Read a single CSV file.  Return a promise that resolves with the raw CSV data.
//
export const readOneCSV = dataset => {
  const location = root + '/' + dataset + '.csv';

  // Make sure that csvtojson doesn't convert numbers to strings
  //
  const numerics = [];
  const colParser = numerics.reduce((i, j) => {
    return {...i, ...{[j]: 'number'}};
  }, {});

  // console.log('Reading CSV file: ' + location + '...');
  return csv({colParser}).fromFile(location).then((rawData) => {
    console.log('  Read OK for CSV file: ' + location + ', # records=' + rawData.length);
    return rawData;
  }).catch((error) => {
    console.log('  Read FAILED for CSV file: ' + location + ', error=' + error);
    return [];
  });
}

// This version reads a CSV with a check for a change to column values from legacy to new,
// so we avoid unwanted number-to-string conversions
//
export const readOneWithLegacy = function(dataset, targetDataset, legacyMap){
  const location = '../../../src/static/data/' + dataset + '.csv';
  console.log('Reading ' + location);

  metadata.setMetadata(targetDataset);
  const numerics = metadata.getAverageableNumerics();

  // Make sure to take into account column names that changed
  //
  const oldToNewColMap = legacyMap.reduce((i, j) => {
    const oldCol = j.old;
    const newCol = j.new;
    return {...i, ...{[oldCol]: newCol}};
  }, {});

  const newNumerics = numerics.filter(i => oldToNewColMap.hasOwnProperty(i)).map(i => oldToNewColMap[i]);
  const allNumerics = numerics.concat(newNumerics);

  // Make sure that csvtojson doesn't convert numbers to strings
  //
  const colParser = allNumerics.reduce((i, j) => {
    return {...i, ...{[j]: 'number'}};
  }, {});

  return csv({colParser}).fromFile(location).then((rawData) => {
    console.log('  Read ' + location + '.  input #rec=' + rawData.length);
    return rawData;
  });
}

// Parse the Excel data by applying metadata schema to it.
//
const parseXlsxData = (data, metadata) => {
  const schema = metadata && metadata.schema ? metadata.schema : [];
  const schemaMap = schema.reduce((i, j) => {
    const name = j.inputName || j.name;
    return {...i, ...{[name]: j}};
  }, {});
  const requiredCols = schema.filter(i => i.required).map(i => {
    return i.inputName || i.name;
  });
  return data.filter(i => {
    return requiredCols.reduce((j, k) => {
      return j && i.hasOwnProperty(k);
    }, true);
  }).map(i => {
    return Object.keys(i).reduce((j, k) => {
      const thisSchema = schemaMap.hasOwnProperty(k) ? schemaMap[k] : {};
      const inputCol = thisSchema.inputName || k;
      const outputCol = thisSchema.name || k;
      const colType = thisSchema.type || 'string';
      const value = i[k];
      const typedValue = getTypedValue(colType, value);

      const mapped = {[outputCol]: typedValue};
      return {...j, ...mapped};
    }, {});
  });
}

const getTypedValue = (type, value) => {
  return type === 'string'
    ? value.toString()
    : type === 'number'
    ? toNum(value)
    : type === 'date'
    ? toDate(value)
    : value;
}

// This numeric converter will return a number if possible, but 'value' if not
// (instead of e.g. null).
//
const toNum = value => {
  const res = parseInt(value, 10);
  return res === 'NaN' ? value : res;
}

// Looks like dates are correctly formatted.  See XLSX.utils.sheet_to_json, {raw: true}.
//
const toDate = value => {
  return value;
}

// Given a JSON data object, write it to CSV file with the given dataset name.
// Don't change existing CSV data in the dataset, so that a mistake in this
// script does not delete useful historical cache.
//
export const writeCSV = (dataset, data) => {
  return new Promise((resolve, reject) => {
    const location = root + '/' + dataset + '.csv';
    // console.log('Writing CSV file: ' + location + '...');

    return fastcsv.writeToPath(location, data, { headers: true })
      .on('finish', () => {
        console.log('  Write OK for CSV file: ' + location + ', output #records=' + data.length);
        resolve(data);
      })
      .on('error', error => {
        console.log('  Write FAILED for CSV file: ' + location + ', error=' + error);
        reject('error');
      });
  });
}

// Write 'data' named 'dataset' into the 'folder'.
//
export const writePDF = (folder, dataset, data) => {
  const location = `${folder}/${dataset}.pdf`;

  try {
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder);
    }
    fs.writeFileSync(location, data);
  } catch (err) {
    console.log('PDF file error: ' + err);
  }
}
