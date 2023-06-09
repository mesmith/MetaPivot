import React from 'react';
import {connect} from 'react-redux';
import metadata from './metadata';
import utils from './utils';
import actions from '../../actions';
import constants from './constants';
import Select from './select';

import {Container, Row, Col, Button} from 'react-bootstrap';

const whatIfControls = {
  id: 'what-if',
  name: 'what-if',
  label: 'Modify Load For',
  headerClass: 'header',
  disabled: false,
  list: [],
};

const firstLine = {
  name: 'choose', label: '--Choose a Value--', value: null
};

const secondLine = {
  name: constants.generalImprovement, label: 'General Improvement--All Calls',
  value: constants.generalImprovement
};


// Implement the React summary table
//
class WhatIfChart extends React.Component {
  constructor(props) {
    super(props);
    this.onChangeHandler = this.onChangeHandler.bind(this);
    this.onInputChange = this.onInputChange.bind(this);
    this.onDelete = this.onDelete.bind(this);
    this.onSubmit = this.onSubmit.bind(this);

    this.state = {
      table: []
    };
  }

  // Called when the user changes the selection.
  //
  onChangeHandler(name, value) {
    const { table } = this.state;
    if (value === null) return;

    const exists = table.find(i => {
      return i.value === value;
    });

    if (!exists) {
      const tableMap = metadata.getReverseMap('whatIfTarget');
      const headers = Object.keys(tableMap);
      const row = headers.reduce((i, j) => {
        return {...i, ...{[j]: 100}};
      }, {value});
      const newTable = table.concat([row]).sort(utils.sorter('value'));
      
      this.setState({ table: newTable });
    }
  }

  // Handle change to a load value. Because would causes a full chart change
  // for every little edit,
  // we force user to press Submit first before sendint Redux action.
  //
  onInputChange(attr, row) {
    const self = this;
    return function(e) {
      const { table } = self.state;
      const value = +e.target.value;
      const newTable = table.map(i => {
        return i.value === row.value ? {...i, ...{[attr]: value}} : i;
      });
      self.setState({ table: newTable });
    }
  }

  onDelete(row) {
    const self = this;
    const { onChangeLoadDispatch } = this.props;
    return function() {
      const { value } = row;
      const { table } = self.state;
      const newTable = table.filter(i => {
        return i.value !== value;
      });
      self.setState({ table: newTable });

      onChangeLoadDispatch(newTable);
    }
  }

  onSubmit() {
    const { onChangeLoadDispatch } = this.props;
    const { table } = this.state;

    onChangeLoadDispatch(table);
  }

  render(){
    const { controls, show, value } = this.props;
    const { table } = this.state;

    const tableMap = metadata.getReverseMap('whatIfTarget');
    const headers = Object.keys(tableMap);
    const remainingCols = 6;  // The Name and Del cols take up 6 slots
    const headerWidth = Math.floor(remainingCols / headers.length);
    const catList = metadata.getCategoricalList(value.tooltipPivots, 'noWhatIf');
    const choices = [firstLine, secondLine].concat(catList.map(i => {
      return { name: i.alias, label: i.alias, selected: false };
    }));
    const selectValue = {...whatIfControls, list: choices};
    const showClass = this.props.show ? 'chartShow' : 'chartNone';
    return (
      <div className={"what-if-chart " + showClass}>
        <h2>What if loads change?</h2>
        <Container className="what-if-table">
          <Row key="header" className="what-if-header">
            <Col sm={5}>Name</Col>
            {headers.map(i => {
              return <Col key={i} sm={headerWidth}>{i}</Col>
            })}
          </Row>
          {table.map(i => {
            return (
              <Row key={i.value} className="what-if-body">
                <Col sm={5}>{i.value}</Col>

                {headers.map(j => {
                  return (
                    <Col key={j} sm={headerWidth}>
                      <input value={i[j]}
                          onChange={this.onInputChange(j, i)}
                          className="what-if-input"
                          type="text" />
                      <span>%</span>
                    </Col>
                  );
                })}

                <Col sm={1}>
                  <Button onClick={this.onDelete(i)}>Del</Button>
                </Col>
              </Row>
            );
          })}
          <Row>
            <Col sm={6}>
              <Button onClick={this.onSubmit}>Submit</Button>
            </Col>
          </Row>
        </Container>
        <Select value={selectValue} changeHandler={this.onChangeHandler}/>
      </div>
    )
  }
}

const mapStateToProps = function(state) {
  return {};
}

const mapDispatchToProps = function(dispatch) {
  return {

    // Dispatch Redux "change load" message
    //
    onChangeLoadDispatch: function(table) {
      actions.changeLoad(table)(dispatch);
    }
  };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(WhatIfChart);
