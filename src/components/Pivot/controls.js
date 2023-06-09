// Methods for user-selectable controls
//
import metadata from './metadata.js';
import utils from './utils.js';
import constants from './constants.js';

const controls = function(){
  const dfltControls = {
    animate: {
      id: 'a-axis',
      name: 'animate',
      label: 'Time Animation',
      headerClass: 'control-header',
      disabled: false,
      list: [],
    },
    datapoint: {
      id: 'datapoint',
      name: 'datapoint',
      label: 'Aggregate By',
      headerClass: 'control-header',
      disabled: false,
      list: [],
    },
    xAxis: {
      id: 'x-axis',
      name: 'xAxis',
      label: 'X Axis',
      headerClass: 'control-header',
      disabled: false,
      list: [],
    },
    yAxis: {
      id: 'y-axis',
      name: 'yAxis',
      label: 'Y Axis',
      headerClass: 'control-header',
      disabled: false,
      list: [],
    },
    radiusAxis: {
      id: 'r-axis',
      name: 'radiusAxis',
      label: 'Size',
      headerClass: 'control-smallheader',
      disabled: false,
      list: [],
    },
    colorAxis: {
      id: 'c-axis',
      name: 'colorAxis',
      label: 'Color',
      headerClass: 'control-smallheader',
      disabled: false,
      list: [],
    }
  };

  // This is a rule that indicates how a change to the "Graph Type"
  // radio control affects the 'disabled' state of other controls.
  //
  const graphTypeEnable = {
    bubble: [ 'xAxis', 'yAxis', 'colorAxis', 'radiusAxis', 'animate', 
        'datapoint' ],
    pareto: [ 'yAxis', 'colorAxis', 'datapoint' ],
    line: [ 'xAxis', 'yAxis', 'datapoint', 'colorAxis' ],
    force: [ 'datapoint' ],
    forceStatus: [ 'datapoint' ],
    map: [ 'datapoint', 'colorAxis'],
    default: [ 'xAxis', 'yAxis', 'colorAxis', 'radiusAxis', 'animate', 
        'datapoint' ],
  };

  // Return TRUE if 'control' is enabled for the value in 'graphtype'
  // for the graphtype control.
  //
  const isEnabled = function(graphtype, control){
    if (graphTypeEnable.hasOwnProperty(graphtype)) {
      return graphTypeEnable[graphtype].indexOf(control) !== -1;
    } else {
      return graphTypeEnable.default.indexOf(control) !== -1;
    }
  }

  // Return the default graphtype.  Return '' if there isn't one
  //
  const getGraphtypeDefault = function(){
    return constants.graphtypeControls.list.reduce(function(v1, v2){
      return v2.default? v2.value: v1;
    }, '');
  }

  // Given a graphtype value, return a new list of graphtype controls
  //
  const getGraphtypeControls = function(graphtype, datapointCol){
    const list = constants.graphtypeControls.list.map(i => {
      const enabled = i.value !== 'pareto' ||
        !metadata.getAttrValue(datapointCol, 'noPareto', false)
      return {...i, checked: (i.value === graphtype), disabled: !enabled};
    });

    return {...constants.graphtypeControls, list};
  }
  
  // Return a list of choices for the given control.
  // The list is of the form [{col: COLUMN, alias: ALIAS}, ...]
  // and is sorted by alias.
  //
  // The choices are limited by the 'no?Axis' attributes of the column,
  // as well as by the 'onlyWithDatapoint' attribue.
  //
  const getControlChoices = function(graphtype, control, categoricalValues,
      datapointCol){
    switch( control ){
      case 'graphtype':  // Note: This list is not sorted.
        return constants.graphtypeControls.list.map(i => {
          return {col: i.value, alias: i.label};
        })

      case 'datapoint':
        return metadata.getColumnsWithAttrTrue('datapoint')
          .filter(i => graphtype !== 'pareto' || !metadata.getAttrValue(i, 'noPareto', false))
          .map(i => {
            return {col: i, alias: metadata.getDatapointAlias(i)};
          }).sort(utils.sorter('alias'));

      case 'xAxis':
      case 'yAxis':
      case 'radiusAxis':
      case 'colorAxis': {
        const getNoAttr = function(attr) {
          return metadata.getColumnsWithAttrTrue(attr).reduce((i, j) => {
            return {...i, ...{[j]: true}};
          }, {});
        };

        const noVec = [
          {axis: 'all', no: 'noAxis'}, 
          {axis: 'xAxis', no: 'noXAxis'}, 
          {axis: 'yAxis', no: 'noYAxis'},
          {axis: 'colorAxis', no: 'noColor'},
          {axis: 'radiusAxis', no: 'noRadius'}
        ];
        const filterVector = noVec.reduce((i, j) => {
          return {...i, ...{[j.axis]: getNoAttr(j.no)}};
        }, {});

        const filterFn = function(control, filterVector) {
          return function(col) {
            return metadata.isAllowedForDatapoint(datapointCol, col) &&
                !filterVector.all.hasOwnProperty(col) &&
                !filterVector[control].hasOwnProperty(col);
          }
        }(control, filterVector);

        // Numeric columns.  These are most useful when analyzing metrics.
        //
        const numerics = metadata.getNumerics()
          .filter(filterFn)
          .map(i => [ {col: i, alias: metadata.getAlias(i)} ]).flat();

        // If the current datapoint is a date, then it's
        // a valid x or y axis choice (unless it has a noAxis filter setting).
        // In addition, if it's a DateString, then its output column is a valid
        // x or y choice.
        //
        const getDateRecs = function(control){
          const isCartesianAxis = control==='xAxis' || control==='yAxis';
          const datapointVec = isCartesianAxis &&
              (metadata.hasAttributeValue(datapointCol, 'type', 'Date') ||
                metadata.hasAttributeValue(datapointCol, 'type', 'IsoDate')) &&
              filterFn(datapointCol)
            ? [{ col: datapointCol, alias: metadata.getAlias(datapointCol) }]
            : [];
          const outputCol = metadata.getDateOutputCol(datapointCol);
          const outputVec = isCartesianAxis &&
              metadata.hasAttributeValue(datapointCol, 'type', 'DateString') &&
              outputCol && filterFn(outputCol)
            ? [{ col: outputCol, alias: metadata.getAlias(outputCol) }]
            : [];
            
          return datapointVec.concat(outputVec);
        }

        // The counts of categorical values.  These are useful when
        // determining highest impact of classifications.
        //
        const categoricals = 
            metadata.getCategoricalListFromFilter(categoricalValues, filterFn);

        return numerics
          .concat(getDateRecs(control))
          .concat(categoricals)
          .sort(utils.sorter('alias'));
      }

      case 'animate':

        return [{col: 'None', alias: 'None'}].concat(
          metadata.getColumnsWithAttrTrue('animation').map(function(x){
            return {col: x, alias: metadata.getAlias(x)};
          }).sort(utils.sorter('alias'))
        );
    }
  }

  // Return 'true' if 'alias' represents the default pivot value
  //
  const isDefaultPivotValue = function(control, col, alias){
    const dflts = {
      xAxis: 'defaultXValue',
      yAxis: 'defaultYValue',
      colorAxis: 'defaultColorValue',
      radiusAxis: 'defaultRadiusValue',
    };
    if (dflts.hasOwnProperty(control)) {
      const dfltValue = metadata.getAttrValue(col, dflts[control]);
      const pivot = dfltValue === 'self' ? alias : metadata.getAlias(col) + ':' + dfltValue;
      const res = !!(dfltValue && pivot===alias);
      return res;
    }
    return false;
  }

  // This returns the initial state of all of the controls.
  //
  // By default, the initial selections will be the 0th one in the list of
  // choices.
  //
  const getInitControlState = function(categoricalValues, datapointCol,
      graphtype){
    return [ 'xAxis', 'yAxis', 'colorAxis', 'radiusAxis', 
        'animate', 'datapoint', 'graphtype' ].reduce(function(v1, control){

      const choices = getControlChoices(graphtype, control, categoricalValues, datapointCol);
      switch( control ){
        case 'graphtype': {
          const dflt = choices.length>0 ? choices[0] : '';
          const choice = choices.reduce((i, j) => {
            return (j.col === graphtype) ? j : i;
          }, dflt);

          // Note that this control returns the "column" (actually, just
          // a virtualized name for the chart type)
          //
          return {...v1, graphtype: choice.col};
        }
          
        case 'animate': {
          const choice = choices.length>0 ? choices[0] : '';

          // Note that this control returns the alias
          //
          return {...v1, animate: choice.alias};
        }

        case 'datapoint': {
          const selected = choices.reduce(function(v3, v4, i){
            return v4.col === datapointCol ? i : v3;
          }, 0);
          const choice = choices.length>0 ? choices[selected] : '';

          // Note that the datapoint returns the column, not the alias
          //
          return {...v1, datapoint: choice.col};
        }

        case 'xAxis':
        case 'yAxis':
        case 'radiusAxis':
        case 'colorAxis': {
          const selected = choices.reduce(function(v3, v4, i){
            const sel = isDefaultPivotValue(control, v4.col, v4.alias);
            return sel? i : v3;
          }, 0);
          const choice = choices.length>0 ? choices[selected] : '';

          // Note that these controls return the alias
          //
          return {...v1, ...{[control]: choice.alias}};
        }
      }
    }, {});
  }

  // Return the set of control choices that are React-friendly.
  //
  const getReactControlChoices = function(graphtype, control, state,
       categoricalValues, datapointCol, geoCols){
    const enabled = isEnabled(graphtype, control);

    switch( control ){
      case 'animate':

        // 'animate' has the interesting rule that a value other than the 0th
        // one is allowed only if the widget is enabled.  This will, e.g.,
        // set Animation to None if graphtype isn't 'bubble'.
        //
        return getControlChoices(graphtype, control, categoricalValues, datapointCol)
          .map((i, j) => {
            return {
              checked: enabled? (i.col==state[control]): (j==0),
              name: i.col,
              label: i.alias,
              value: i.col,
              disabled: !enabled,
            }
          });
      case 'datapoint':
        return getControlChoices(graphtype, control, categoricalValues, datapointCol)
          .map(i => {

            // The datapoint control has a special rule when graphtype is 
            // "map": it only allows columns that are in getGeoCols().
            //
            const disabled = !enabled || 
                (graphtype=="map" && !geoCols.hasOwnProperty(i.col));
            const res = {
              name: i.col,
              label: i.alias,
              disabled: disabled,
              selected: i.col==state[control],
            };
            return res;
          });
      case 'xAxis':
      case 'yAxis':
      case 'radiusAxis':
      case 'colorAxis':
        const controls = getControlChoices(graphtype, control, categoricalValues, datapointCol)
          .map(i => {
            const res = {
              col: i.col,
              name: i.alias,
              label: i.alias,
              disabled: !enabled,
              selected: i.alias==state[control],
            };
            return res;
          });

          return controls;
      default:
        return [];
    }
  }

  // Return a d3config object that takes into account the current
  // values for each of the axis controls.
  //
  // This is needed when an axis control represents a time value:
  // the d3 configuration needs to contain the time axis and time scale.
  //
  // The affected fields:
  //    xAxis, yAxis, xScale, yScale, cScale, rScale.
  //
  const getConfigFromControls = function(axisValues, d3config) {
    const axes = ['x', 'y', 'r', 'c'];
    const plottedAxes = ['xAxis', 'yAxis'];
    const isoDateCols = metadata.getColsWithType('IsoDate');
    const isoDateAliases = isoDateCols.reduce((i, j) => {
      return {...i, ...{[metadata.getAlias(j)]: j}};
    }, {});

    const configAxes = plottedAxes.reduce((i, j) => {
      const alias = axisValues.hasOwnProperty(j) ? axisValues[j] : null;
      const plottedAxisName = isoDateAliases.hasOwnProperty(alias)
        ? `${j}Time`
        : j;
      const plottedAxisConfig = d3config.hasOwnProperty(plottedAxisName)
        ? d3config[plottedAxisName]
        : d3config[j]
      return {...i, ...{[j]: plottedAxisConfig}};
    }, {});

    const configScales = axes.reduce((i, j) => {
      const axisName = `${j}Axis`;
      const scaleName = `${j}Scale`;
      const alias = axisValues.hasOwnProperty(axisName)
        ? axisValues[axisName]
        : null;
      const plottedScaleName = isoDateAliases.hasOwnProperty(alias)
        ? `${scaleName}Time`
        : scaleName;
      const plottedScaleConfig = d3config.hasOwnProperty(plottedScaleName)
        ? d3config[plottedScaleName]
        : d3config[scaleName];
      return {...i, ...{[scaleName]: plottedScaleConfig}};
    }, {});
    return {...d3config, ...configAxes, ...configScales};
  }

  // Return the externally visible functions
  //
  return {
    dfltControls,
    getGraphtypeDefault,
    getGraphtypeControls,
    getReactControlChoices,
    isEnabled,
    getInitControlState,
    getConfigFromControls
  }
}();

export default controls;
