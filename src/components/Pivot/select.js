// This contains the <select> controls
//
import React from 'react';
import {connect} from 'react-redux';
import actions from '../../actions';
import metadata from './metadata.js';

// Return a list of [ { axis, defaultCol }, ... ]
// containing the axes and default columns for all axes where the
// current axis value is invalid for the datapoint.
//
const getDefaultVector = (axes, datapointCol) => {
  return ['xAxis', 'yAxis', 'radiusAxis', 'colorAxis'].filter(i => {
    const alias = axes[i];
    const axisCol = metadata.aliasToColumn(alias);
    const defaultCol = metadata.getDefaultColForControl(i);
    return !metadata.isAllowedForDatapoint(datapointCol, axisCol) && 
        metadata.isAllowedForDatapoint(datapointCol, defaultCol);
  }).reduce((i, j) => {
    return { ...i, [j]: metadata.getAlias(metadata.getDefaultColForControl(j)) };
  }, {});
}

class Select extends React.Component {
  constructor(props) {
    super(props);
    this.onChangeHandler = this.onChangeHandler.bind(this);
    this.getDateOutputAlias = this.getDateOutputAlias.bind(this);
  }

  // Called when the user selects an <option>.
  // Send a Redux message.
  //
  onChangeHandler(name, changeHandler){
    const {
      axes,
      onChangeControlDispatch,
      onChangeControlVectorDispatch,
      onChangeDatasetAndDatapointDispatch
    } = this.props;

    const self = this;

    return function(e){

      // Dispatch Redux "change control" message.  This will cause
      // controls to update, as well as new data to be plotted.
      //
      const col = e.target.value;
      const datasetName = metadata.getAttrValue(col, 'datasetName', null);
      if (changeHandler) {
        changeHandler(name, col);
      } else if (datasetName) {
        onChangeDatasetAndDatapointDispatch(datasetName, col);
      } else {
        const controls = {[name]: col};

        // See if there is a graphtype control for this datapoint change
        //
        const graphtypeAttr = metadata.getAttrValue(col, 'graphtype');
        const graphtype = name === 'datapoint' && graphtypeAttr
          ? graphtypeAttr
          : null;
         const withGraphtype = graphtype ? { ...controls, graphtype } : controls;

        // This contains default alias names where the current column 
        // for a particular axis is not valid for the new datapoint.
        //
        const defaultVector = name === 'datapoint'
          ? getDefaultVector(axes, col)
          : {};

        // Special handling for the case where the control is 'datapoint' and
        // the datapoint columm is a DateString.  Force the X axis to be
        // the DateString's 'output' column.
        //
        const dateOutputAlias = self.getDateOutputAlias(name, col);
        const withDateOutput = dateOutputAlias ? { xAxis: dateOutputAlias } : {};

        const all = { ...withGraphtype, ...defaultVector, ...withDateOutput };

        onChangeControlVectorDispatch(all);
      }
    }
  }

  // Return the alias of the output column for datapointCol, if datapointCol is
  // a date, and if we are setting a new datapoint.  Return null if not.
  //
  getDateOutputAlias = (control, datapointCol) => {
    const outputColRaw = metadata.getAttrValue(datapointCol, 'output');
    const outputCol = 
        control === 'datapoint' && metadata.hasAttributeValue(datapointCol, 'type', 'DateString')
          ? outputColRaw
          : null;
    return outputCol ? metadata.getAlias(outputCol) : null;
  }

  // Given an ordered list of (value, label, disabled, selected)
  // within props, return a <select> element with a list of <option>s
  //
  render(){
    const { value, changeHandler } = this.props;
    const { id, list, name, label, headerClass, disabled } = value;
    const handler = this.onChangeHandler;

    // Get the currently selected index.  There can be only one.
    // Selects '' if list contains no truthy 'selected' attribute.
    //
    const selected = list.reduce(function(v1, v2){
      return v2.selected? v2.name: v1;
    }, '');

    // If the entire control is disabled, show "None" for its value
    //
    const disabledElt = {name: '(None)', disabled: true, label: '(None)'}
    const withDisabled = disabled ? [disabledElt] : list;
    const selects = withDisabled.map(function(x, i){
      return (
        <option key={x.name} value={x.name} disabled={x.disabled}>
          {x.label}
        </option>
      )
    });

    const className = "bold " + headerClass;
    const controlValue = disabled ? '' : selected;
    const selectClass = `${name} axis-selector`;

    return (
      <div className={"control pivot-div"}>
        <span className={className}>
          {label}:&nbsp;
        </span>
        <select name={name}
            className={selectClass}
            value={controlValue}
            disabled={disabled}
            onChange={handler(name, changeHandler)}>
          {selects}
        </select>
      </div>
    );
  }
}

const mapStateToProps = function(state) {
  return {};
}

const mapDispatchToProps = function(dispatch) {
  return {

    // Dispatch Redux "change control" and "change dataset and datapoint"
    // messages
    //
    onChangeControlDispatch: function(name, col) {
      actions.changeControl(name, col)(dispatch);
    },
    onChangeControlVectorDispatch: function(controls) {
      actions.changeControlVector(controls)(dispatch);
    },
    onChangeDatasetAndDatapointDispatch: function(name, col) {
      actions.changeDatasetAndDatapoint(name, col)(dispatch);
    }
  };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Select);
