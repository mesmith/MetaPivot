// Turning off eslint warnings:
/* global d3 */
//
import React from 'react';
import {connect} from 'react-redux';

// import { hot } from 'react-hot-loader/root';
import { Loader } from 'react-overlay-loader';
import 'react-overlay-loader/styles.css';

import PivotContainer from './pivot-container.js';
import SelectDataset from './select-dataset.js';

import actions from '../../actions';
import controls from './controls.js';
import datapoint from './datapoint.js';
import dataread from './dataread.js';
import metadata from './metadata.js';
import startup from './startup';
import transforms from './transforms.js';
import constants from './constants.js';
import utils from './utils.js';

import '../../static/colorbrewer.css';
import '../../static/styles.css';
import '../../static/tipsy.css';

// Control/selection prototypes
//
const datasetControls = {
  id: 'dataset',
  name: 'dataset',
  label: 'Select a dataset',
  headerClass: 'dataset',
  disabled: false,
  list: [],
};

const pureAxisNames = [ 'colorAxis', 'radiusAxis', 'xAxis', 'yAxis' ];
const otherAxisNames = [ 'datapoint', 'animate' ];
const graphAxisNames = [ 'graphtype' ];

const axisNames = pureAxisNames.concat(otherAxisNames);

// Return the datapoint column, used when getting original data and then
// potentially transforming it.
//
// If the dataset specifies its datapoint, it means that this is a simulated
// dataset and we need to use the datapoint from the original dataset.
// Otherwise, we use the redux state if it's been set (presumably through
// the "Aggregate By" control).  Finally, if none of the above is true,
// just get the default datapoint.
//
const getDatapointCol = function(currentState){
  const datapointForDataset = metadata.getDatasetAttr('datapointCol');
  const datapointForReduxStore = getReduxStateDatapoint(currentState);
  const dfltDatapoint = datapoint.getDefaultDatapointCol();
  return datapointForDataset || datapointForReduxStore || dfltDatapoint;
}

// Return the datapoint in the current state, from the Aggregate By control.
//
const getReduxStateDatapoint = function(currentState) {
  return currentState && currentState.hasOwnProperty('datapoint') && 
      currentState.datapoint
    ? currentState.datapoint
    : null;
}

// Return the datapoint col that is used when transitioning from one dataset
// to another.  In that case, the redux state may not contain the datapoint
// col we want to return, in the case where the new dataset is a simulated
// dataset.  Tricky.
//
const getInitDatapointCol = function() {
  const colForDataset = metadata.getDatasetAttr('datapointCol');
  const dfltDatapointCol = datapoint.getDefaultDatapointCol();
  return colForDataset || dfltDatapointCol;
}

// Called when pivoted data is available.
// 
// Returns the state of all of the controls.
//
const getControlState = function(currentState, dfltDatapointCol,
    categoricalValues, pivotedData) {
  const graphtype = currentState.graphtype || controls.getGraphtypeDefault();
  const datapointCol = dfltDatapointCol || currentState.datapoint;

  const datasetChoices = getDatasetChoices();
  const chartControlState = getChartControlState(currentState, graphtype, 
      categoricalValues, datapointCol);

  return {
    dataset: {...datasetControls, list: datasetChoices},
    graphtype: controls.getGraphtypeControls(graphtype, datapointCol),
    ...chartControlState
  }
}

// Return the state of all chart controls
//
const getChartControlState = function(currentState, graphtype, categoricalValues,
    datapointCol) {
  const enabled = getAllEnabled(graphtype);
  const choices = getAllControlChoices(graphtype, currentState,
      categoricalValues, datapointCol);
  return Object.keys(controls.dfltControls).reduce((i, j) => {
    const obj = {[j]: {
      ...controls.dfltControls[j],
      disabled: !enabled[j],
      list: choices[j]}
    };
    return {...i, ...obj};
  }, {});
}

// Return the choices for the dataset, given the current redux store and
// the list of all datasets from metadata.
//
// If we're currently using a synthetic dataset, we use the name of
// its "actual" dataset.  Synthetic datasets don't appear in the list.
//
const getDatasetChoices = function(){
  const dataset = metadata.getActualDataset();
  return metadata.getAllDatasets().map(i => {
    return {...i, label: i.alias, selected: i.name === dataset};
  });
}

const getAllEnabled = function(graphtype){
  return Object.keys(controls.dfltControls).reduce(function(i, j){
    return {...i, ...{[j]: controls.isEnabled(graphtype, j)}};
  }, {});
}

// Return the choices for every control
//
const getAllControlChoices = function(graphtype, state, categoricalValues,
    datapointCol){
  const geoCols = metadata.getGeoCols().reduce(function(v1, v2){
    return {...v1, ...{[v2]: true}};
  }, {});

  return Object.keys(controls.dfltControls).reduce(function(v1, v2){
    const value = controls.getReactControlChoices(graphtype, v2,
        state, categoricalValues, datapointCol, geoCols);
    return {...v1, ...{[v2]: value}};
  }, {});
}

// Return the disabled state for every control
//
const getAllControlDisabled = function(graphtype){
  return Object.keys(controls.dfltControls).reduce(function(v1, v2){
    const dis = !controls.isEnabled(graphtype, v2);
    return {...v1, ...{[v2]: dis}};
  }, {});
}

// This converts the currentState into an axes object.
//
// This also may change the axes values that don't
// appear in the control state.  In that case, the first
// axis choice will be selected.
//
const getAxesFromReduxState = function(state, controlState) {
  
  // This isn't one of the axes,
  // but it's a control that's passed into drawing routines
  //
  const nonAxis = {graphtype: state.graphtype};

  if (controlState) {
    const newAxes = axisNames.reduce((i, j) => {
      const list = controlState[j].list;
      const oldValue = state[j];
      const valueExists = Array.isArray(list) && list.filter(k => {
        return k.name === oldValue;
      });
      if (valueExists.length === 0) {
        const firstValue = Array.isArray(list) ? list[0].name : null;
        return {...i, ...{[j]: firstValue}};
      } else {
        return {...i, ...{[j]: oldValue}};
      }
    }, {});

    return {...newAxes, ...nonAxis};
  } else {
    const ax = axisNames.reduce((i, j) => {
      return {...i, ...{[j]: state[j]}};
    }, {});
    return {...ax, ...nonAxis};
  }
}

// Return the alias of the output column for datapointCol, if datapointCol is
// a date.  Return null if not.
//
const getDateOutputAlias = (datapointCol, last) => {
  const outputColRaw = metadata.getAttrValue(datapointCol, 'output');
  const outputCol = last === 'datapoint' && 
        metadata.hasAttributeValue(datapointCol, 'type', 'DateString')
        ? outputColRaw
        : null;
  return outputCol ? metadata.getAlias(outputCol) : null;
}

// Return true if the load table changed
//
const didLoadTableChange = (oldLoadTable, newLoadTable) => {
  const oldIsArray = Array.isArray(oldLoadTable);
  const newIsArray = Array.isArray(newLoadTable);
  if (!oldIsArray && !newIsArray) {
    return false;
  }
  if ((oldIsArray && !newIsArray) || (!oldIsArray && newIsArray)) {
    return true;
  }
  const oldMap = oldLoadTable.reduce((i, j) => {
    return {...i, [j.value]: j.Load};
  }, {});
  const newMap = newLoadTable.reduce((i, j) => {
    return {...i, [j.value]: j.Load};
  }, {});

  const inOld = newLoadTable.reduce((i, j) => {
    const value = j.value;
    const same = oldMap.hasOwnProperty(value) && oldMap[value] === j.Load;
    return i && same;
  }, true);

  const inNew = oldLoadTable.reduce((i, j) => {
    const value = j.value;
    const same = newMap.hasOwnProperty(value) && newMap[value] === j.Load;
    return i && same;
  }, true);

  return !(inOld && inNew);
}

// Return the enabled/disabled state for every control for 'graphtype'
//
class MetaPivot extends React.Component {
  constructor(props){
    super(props);

    this.handleReduxStateChange = this.handleReduxStateChange.bind(this);
  }

  // Called when the properties change, presumably because the Redux state changed.
  //
  // Sets local state, and potentially sends a Redux event.
  //
  handleReduxStateChange(nextProps) {
    const currentState = utils.getCurrentState(nextProps);

    // Determine if the dataset changed.   If so, use the metadata
    // for the new dataset.
    //
    // This only runs doing Undo and Redo, so the dataset's data
    // is already available in props: there's no need to get it
    // from the data source.
    //
    const dataset = currentState.dataset || metadata.getActualDataset() ||
        metadata.getInitDataset();
    if (metadata.getDataset() !== dataset) {
      metadata.setMetadata(dataset);  // FIXME: mutable
      this.setState({loading: false});
      return;
    }

    const { onMergeStateDispatch } = this.props;
    const oldCurrentState = utils.getCurrentState(this.props);
    const { categoricalValues } = currentState;
    const loadTable = currentState && currentState.loadTable
      ? currentState.loadTable
      : null;

    // Determine if filter changed
    //
    const oldFilter = oldCurrentState ? oldCurrentState.filter : null;
    const filter = currentState.filter || metadata.getFilters();
    const filterChanged = oldFilter && filter &&
        JSON.stringify(oldFilter) !== JSON.stringify(filter);

    const self = this;

    // Determine if the datapoint changed
    //
    const oldDatapointCol = getDatapointCol(oldCurrentState);
    const datapointCol = getDatapointCol(currentState);
    const datapointChanged = oldDatapointCol && datapointCol &&
        oldDatapointCol !== datapointCol;

    // Determine if load table changed
    //
    const oldLoadTable = oldCurrentState.loadTable;
    const loadTableChanged = didLoadTableChange(oldLoadTable, loadTable);

    // CSV local state is returned synchronously;
    // Mongo local state is returned via an async call.
    //
    // This case happens on both Undo/Redo and in response
    // to a datapoint selection or filter change, so we must get new data.
    //
    if (filterChanged || datapointChanged || loadTableChanged) {

      // Tricky.  If this is a synthetic dataset (e.g. aisTimeMetadata),
      // then we have to use a predetermined datapoint that's in the metadata.
      // Otherwise, we use the one in the current state.
      //
      const colForDataset = metadata.getDatasetAttr('datapointCol');
      const datapointCol = colForDataset || currentState.datapoint;
      const graphtype = currentState.graphtype || controls.getGraphtypeDefault();

      const handle = ((datapointCol, filter, categoricalValues, loadTable) => res => {
        const { pivotedData, processedData } = res;

        const summaryData = transforms.getSummaryData(processedData);
        const loadComparisonData = transforms.getLoadComparisonData(processedData);
        const facet = startup.getFacetObject(pivotedData, filter,
            datapointCol, categoricalValues);

        onMergeStateDispatch({
            facet, loadTable,
            categoricalValues, pivotedData, processedData,
            summaryData, loadComparisonData
        });

        self.setState({loading: false});
      })(datapointCol, filter, categoricalValues, loadTable);

      const handleError = () => handle({pivotedData: [], processedData: []});

      const cmd = (utils.isCSV(dataset) || utils.isJSON(dataset))
        ? 'csv'
        : 'increment';
      dataread.readDataset(cmd, dataset, filter, loadTable, datapointCol,
            graphtype, currentState.animate, null)
          .then(handle)
          .catch(handleError);

      this.setState({loading: true});
    } else {
      this.setState({loading: false});
    }
  }

  // Called after dataset changes when doing an Undo or Redo.
  // Returns the new state of all controls.
  //
  // Fetch initial (potentially async) data for the component here
  // (as is best practice).
  //
  // If initData is not null, it represents a raw dataset that
  // the parent component sends to us.  Without it, we'll fetch
  // data using the dataset name.
  //
  componentDidMount(){
    const { needData, initDataset, initData, onPushStateDispatch } = this.props;
    const currentState = utils.getCurrentState(this.props);

    const newDataset = this.getDatasetName(currentState, initDataset);

    // needData should only be set if we must fetch data.
    // We do NOT have to fetch data when changing datasets if we
    // already have it (e.g. when doing undo/redo across dataset changes).
    //
    if (needData) {
      metadata.setMetadata(newDataset); // FIXME: mutable
      const filter = metadata.getFilters();
      const datapointCol = datapoint.getDefaultDatapointCol();

      const graphtype = currentState && currentState.graphtype
        ? currentState.graphtype
        : controls.getGraphtypeDefault();
      const animationCol = currentState ? currentState.animate : null;
      startup.startup(currentState, newDataset, filter, datapointCol,
          graphtype, animationCol, initData)
        .then(res => {
          const { processedData } = res;
          const summaryData = transforms.getSummaryData(processedData);
          const loadComparisonData = transforms.getLoadComparisonData(processedData);
          const push = {...res, summaryData, loadComparisonData};
          
          // Push the data into redux state.  It should never appear
          // in local state.
          //
          // This will cause componentDidMount() to be re-entered.
          // The re-entry should be safe.
          //
          onPushStateDispatch(push);
        });
    } else {
      this.handleReduxStateChange(this.props);
    }
  }

  // Determine the name of the current dataset.
  // 1.  If this is a change_dataset record, then currentState.to will be
  //     its name.
  // 2.  If we're just transitioning (undo/redo), then currentState.dataset
  //     will be its name.
  // 3.  If there is an initial dataset name, then use that.
  // 4.  Otherwise, look up the default dataset from metadata.
  //
  getDatasetName(currentState, initDataset) {
    return (currentState && currentState.to)
      ? currentState.to
      : (currentState && currentState.dataset)
        ? currentState.dataset
        : initDataset ? initDataset : metadata.getActualDataset();
  }

  componentWillUnmount() {
    if (this && this.unsubscribe) {
      this.unsubscribe();
    }
  }

  // Called after (e.g.) mapStateToProps finishes.
  //
  // Was: componentWillReceiveProps.  That is considered an antipattern,
  // but currently I don't know how to resolve the derived state setting.
  //
  UNSAFE_componentWillReceiveProps(nextProps) {
    this.handleReduxStateChange(nextProps);
  }

  render() {
    const datasetLabel = metadata.getDatasetLabel();
    const key = 'MetaPivot';
    const loaderTextStyle = {
      fontWeight: 'bold',
      color: 'white'
    };
    const emptyComponent = (
      <div key={key} className={"pivot-all pivot-div"}>
        <Loader fullPage loading={true} textStyle={loaderTextStyle}/>
      </div>
    );

    // When the app is starting up, there is no state or props.
    // We want to just show the Loading icon while the initial
    // data is being read in.
    //
    if (!this.state || !this.props) {
      return emptyComponent;
    }

    const { loading } = this.state;

    const { current, history, showDataset, title, subtitle, pivotedData }
        = this.props;

    const currentState = utils.getCurrentState(this.props);

    const { facet, categoricalValues, processedData, summaryData,
        loadComparisonData } = currentState;

    // Note that we get the datapoint from the current state.  If this
    // is a simulated dataset, then the redux state will pull the data
    // out of that simulated dataset (unlike the API, which uses the
    // datapoint from the original dataset, not the simulated one).
    // Tricky.
    //
    const datapointCol = getReduxStateDatapoint(currentState);

    const controls = getControlState(currentState, datapointCol,
       categoricalValues, pivotedData);
    const { dataset } = controls;

    const axes = getAxesFromReduxState(currentState, controls);

    const datasetSubtitle = metadata.getDatasetSubtitleNew(processedData);

    const actualTitle = title ? title : 'Visualizing ' + datasetLabel + ' Data';
    const commitDate = __COMMIT_DATE__ || 'Today';
    const builddate = `(build date: ${commitDate})`;
    const actualSubtitle = subtitle ? subtitle : 
        datasetSubtitle? `${datasetSubtitle} ${builddate}` : null;

    const chartProps = {
      drawingData: processedData,
      tooltipPivots: categoricalValues,
      datapointCol,
      axes
    };
    return (
      <div key={key} className={"pivot-all pivot-div"}>
        <Loader fullPage loading={loading} textStyle={loaderTextStyle} />
        <div className={"pivot-header pivot-div"}>
          <div className={"title pivot-div"}>
            <h1>{actualTitle}</h1>
            { actualSubtitle ? <h2>{actualSubtitle}</h2> : null }
          </div>
          {showDataset ? <SelectDataset value={dataset} /> : null}
        </div>
        <PivotContainer
          loading={loading}
          value={chartProps}
          current={current} history={history}
          facet={facet} controls={controls}
          summaryData={summaryData} loadComparisonData={loadComparisonData}
        />
      </div>
    );
  }
}

// Expect componentDidMount() or componentDidUpdate() to be called
// after this runs.
//
const mapStateToProps = function(state) {
  const { pivot } = state;

  const currentState = utils.getCurrentState(pivot);

  if (currentState) {
    const { current, history, initDataset } = pivot;
    const needData = currentState.last === 'change_dataset';
    const dataset = currentState.dataset || currentState.to || initDataset;
    return { history, current, initDataset, key: dataset, needData };
  } else {
    return {}
  }
}

const mapDispatchToProps = function(dispatch, ownProps) {
  return {

    // Dispatch Redux "Push State" and "Merge State" message
    //
    onPushStateDispatch: function(newReduxState) {
      actions.pushState(newReduxState)(dispatch);
    },
    onMergeStateDispatch: function(newReduxState) {
      actions.mergeState(newReduxState)(dispatch);
    }
  };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(MetaPivot);
