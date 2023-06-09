import actionTypes from '../actionTypes';

// Test function.
//
export const getPivotRequest = function() {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_Request });
  }
};

export const pushState = function (state) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_PushState, state });
  }
}

export const mergeState = function (state) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_MergeState, state });
  }
}

// Called when the user changes a control (e.g. X Axis)
//
export const changeControl = function (name, value) {
  return function(dispatch) {
    dispatch({
      type: actionTypes.pivot_ChangeControl,
      name, value
    });
  }
};

// Similar to the above, but handles the case where multiple controls are
// to be set at once.  Used e.g. when the datapoint becomes a date and
// the X axis becomes the date number.
//
export const changeControlVector = function (controls) {
  return function(dispatch) {
    dispatch({
      type: actionTypes.pivot_ChangeControlVector,
      controls
    });
  }
};

// Called whe the user changes a filter (Refine Results)
//
export const changeFilter = function (filter) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_ChangeFilter, filter });
  }
};

// Called whe the user changes a dataset
//
export const changeDataset = function (dataset) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_ChangeDataset, dataset });
  }
};

// Called whe the user changes a dataset and a datapoint
//
export const changeDatasetAndDatapoint = function (dataset, datapoint) {
  return function(dispatch) {
    dispatch({
      type: actionTypes.pivot_ChangeDatasetAndDatapoint,
      dataset, datapoint
    });
  }
};


// Called when the user presses Previous Viz/Next Viz
//
export const pressButton = function (button) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_PressButton, button });
  }
};

// Called when user changes the load calculation.  DTMO only.
//
export const changeLoad = function (loadTable) {
  return function(dispatch) {
    dispatch({ type: actionTypes.pivot_ChangeLoad, loadTable });
  }
}

export default {
  getPivotRequest,
  pushState,
  mergeState,
  changeControl,
  changeControlVector,
  changeFilter,
  changeDataset,
  changeDatasetAndDatapoint,
  pressButton,
  changeLoad
}
