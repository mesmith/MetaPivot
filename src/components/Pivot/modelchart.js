import React from 'react';
import {Container, Row, Col, Button} from 'react-bootstrap';

import erlangC from './erlangc';
import erlangA from './erlangA';
import metadata from './metadata';
import utils from './utils';
import models from './models';

// Implement the React modeling chart
//
// Allows user to input:
// - current abandonment rate
// - a percentage for any level 1 or level 2 ticket types
//
// Will calculate the current analyst load at saturation.
//
class ModelChart extends React.Component {
  constructor(props) {
    super(props);
    const meta = models.getMeta();
    const nightWeekendState = models.getNightWeekendState(props.data);

    // We need to get the total # of days in the dataset, as well as
    // the total # of working days (so we can calculate agent shrinkage and
    // utilization)
    //
    const days = models.getDays(props.months);
    const workingDays = models.getWorkdays(props.months);
    const shrinkage = Math.round(models.getShrinkageFromData(props.data, props.loadComparisonData, workingDays) * 100);

    this.state = {
      days, workingDays, shrinkage,
      onHoldTime: 30,  // SLA threshold, in seconds
      probAnsweringWithinOnHold: 80, // SLA threshold, in percentage
      desiredAnalystUtilization: 100 - shrinkage,
      shifts: models.getShifts(nightWeekendState)
    }
  }

  // Called when any input field changes
  //
  onInputChange(field) {
    return (e) => {
      const num = e.target.value;
      this.setState({[field]: num});
    }
  }

  // This is considered unsafe, because it set sets and probably shouldn't.
  // I have not figured out how to avoid setting state here.
  //
  UNSAFE_componentWillReceiveProps(props) {
    const { days, workingDays } = this.state;
    const shrinkage =
        Math.round(models.getShrinkageFromData(props.data, props.loadComparisonData, workingDays) * 100);
    const nightWeekendState = models.getNightWeekendState(props.data);
    const shifts = models.getShifts(nightWeekendState);
    const desiredAnalystUtilization = 100 - shrinkage;
    this.setState({ shrinkage, shifts, desiredAnalystUtilization });
  }

  render(){
    const { probAnsweringWithinOnHold, onHoldTime,
        shifts, desiredAnalystUtilization,
        days, workingDays
    } = this.state;

    const { data } = this.props;
    const meta = models.getMeta();

    const nightWeekendState = models.getNightWeekendState(data);
    const totalDaysWorked = data[meta.daysWorkedField];
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }

    const calls = data[meta.calls];
    const waitHours = data[meta.waitHours];
    const analysts = data[meta.analyst];

    const handleTime = data[meta.handleTime];  // in seconds
    const talkSecs = data[meta.talkHours] * 60 * 60;

    const abandonedCallsRegular = data[meta.abandonedCallsRegular];
    const abandonedCallsNW = data[meta.abandonedCallsNW];

    const avgWaitTimeMinutesPerCall = (waitHours * 60) / calls;

    const abandonedCalls =
        models.getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const actualAnalysts = models.getActualAnalysts(totalDaysWorked, workingDays);
    const utilization = desiredAnalystUtilization / 100; 
    const workingAnalysts = (actualAnalysts * utilization) / shifts;

    const inboundCallsPerAnalyst = totalCalls / actualAnalysts;
    const handledCallsPerAnalyst = calls / actualAnalysts;
    const handleTimePerAnalyst = handleTime / actualAnalysts / 3600;  // in hours
    const abandonmentRate = abandonedCalls / totalCalls;

    const averageHandleTime = handleTime / calls / 60;  // in minutes

    const periodMinutes = models.getPeriodMinutes(nightWeekendState, days, workingDays);
    const serviceLevel = probAnsweringWithinOnHold / 100;  // in percentage
    const targetTime = onHoldTime / 60;  // in minutes
    const arrivalRate = totalCalls / periodMinutes;

    const dailyHandleTimePerAnalyst = (handleTimePerAnalyst / workingDays);
    const callsPerMinute = totalCalls / periodMinutes;

    const trafficIntensity = erlangC.TrafficIntensity(callsPerMinute, averageHandleTime);

    const patience = avgWaitTimeMinutesPerCall / abandonmentRate;

    // Get some Erlang projections.
    //
    // Upper bound projections:
    //
    const rawStaff = models.getOptimalStaffFromModel(callsPerMinute, averageHandleTime, serviceLevel,
        targetTime, patience, 'erlangA');
    const projAvgWaitTimeSecsEC = models.getAverageWaitTimeErlangC(totalCalls, periodMinutes, 
      averageHandleTime, rawStaff, shifts, desiredAnalystUtilization);

    const optimalStaffErlangA = models.getStaffAfterShiftAndUtilization(rawStaff, shifts,
        desiredAnalystUtilization);
    const projections = models.getProjections(rawStaff, totalCalls, periodMinutes,
        averageHandleTime, patience, trafficIntensity);
    const projAvgWaitTimeSecs = projections.meanWaitingTime * 60;

    // Lower bound projections.  These use the traffic intensity as the staffing requirement.
    //
    const rawStaffLower = Math.ceil(trafficIntensity);
    const staffForTrafficIntensity = models.getStaffAfterShiftAndUtilization(rawStaffLower,
        shifts, desiredAnalystUtilization);

    const projAvgWaitTimeSecsLowerEC = models.getAverageWaitTimeErlangC(totalCalls, periodMinutes,
      averageHandleTime, rawStaffLower, shifts, desiredAnalystUtilization);

    const projectionsLower = models.getProjections(rawStaffLower, totalCalls, periodMinutes,
        averageHandleTime, patience, trafficIntensity);
    const projAvgWaitTimeSecsLower = projectionsLower.meanWaitingTime * 60;

    const rawStaffCurrent = workingAnalysts;

    const projectionsCurrent = models.getProjections(rawStaffCurrent, totalCalls, periodMinutes,
        averageHandleTime, patience, trafficIntensity);
    const projAvgWaitTimeSecsCurrent = projectionsCurrent.meanWaitingTime * 60;
    const showClass = this.props.show ? 'chartShow' : 'chartNone';

    return (
      <Container className={"model-chart " + showClass}>
        <Row>
          <h2>Labor Model</h2>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            # Analysts:
          </Col>
          <Col sm={3}>
            {analysts}
          </Col>
        </Row>
        <Row>
          <Col className="model-chart-label" sm={9}>
            # Analysts, Adjusted for Days Worked:
          </Col>
          <Col sm={3}>
            {actualAnalysts.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            # Concurrent Working Analysts:
          </Col>
          <Col sm={3}>
            {workingAnalysts.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Traffic Intensity:
          </Col>
          <Col sm={3}>
            {trafficIntensity.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Arrival Rate (Calls per Minute):
          </Col>
          <Col sm={3}>
            {arrivalRate.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Average Wait Time, Actual (Minutes):
          </Col>
          <Col sm={3}>
            {avgWaitTimeMinutesPerCall.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Calls per Analyst, All:
          </Col>
          <Col sm={3}>
            {inboundCallsPerAnalyst.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Calls per Analyst, Connected:
          </Col>
          <Col sm={3}>
            {handledCallsPerAnalyst.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Handling Time per Analyst (Hours):
          </Col>
          <Col sm={3}>
            {handleTimePerAnalyst.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Daily Handling Time per Analyst (Hours):
          </Col>
          <Col sm={3}>
            {dailyHandleTimePerAnalyst.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> Average Handling Time per Call (Minutes):</label>
          </Col>
          <Col sm={3}>
            {averageHandleTime.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Abandonment Rate:
          </Col>
          <Col sm={2}>
            {Math.round(abandonmentRate*100)}
          </Col>
          <Col sm={1}>%</Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            # Abandoned Calls:
          </Col>
          <Col sm={3}>
            {abandonedCalls}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Average Patience until Abandonment (Minutes):
          </Col>
          <Col sm={3}>
            {patience.toFixed(2)}
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> Calculated Analyst Aggregate Utilization:</label>
          </Col>
          <Col sm={2}>
            {100 - this.state.shrinkage}
          </Col>
          <Col sm={1}>%</Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> Desired Analyst Aggregate Utilization:</label>
          </Col>
          <Col sm={2}>
            <input value={this.state.desiredAnalystUtilization} 
                onChange={this.onInputChange('desiredAnalystUtilization')}
                className="model-input"
                type="text" />
          </Col>
          <Col sm={1}>%</Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> Desired Max Wait Time (Seconds):</label>
          </Col>
          <Col sm={3}>
            <input value={this.state.onHoldTime} 
                onChange={this.onInputChange('onHoldTime')}
                className="model-input"
                type="text" />
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> Desired Probability of Answering within On-Hold Time:</label>
          </Col>
          <Col sm={2}>
            <input value={this.state.probAnsweringWithinOnHold} 
                onChange={this.onInputChange('probAnsweringWithinOnHold')}
                className="model-input"
                type="text" />
          </Col>
          <Col sm={1}>%</Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> # of Shifts (for 24/7 operation, use 4.2):</label>
          </Col>
          <Col sm={3}>
            <input value={this.state.shifts} 
                onChange={this.onInputChange('shifts')}
                className="model-input"
                type="text" />
          </Col>
        </Row>

        <Row>
          <hr />
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> # Concurrent Analysts Needed, Upper Bound:</label>
          </Col>
          <Col sm={3}>
            <label> {rawStaff} </label>
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            <label> # Total Analysts Needed, Upper Bound:</label>
          </Col>
          <Col sm={3}>
            <label> {optimalStaffErlangA} </label>
          </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Projected Average Wait Time (Minutes):
          </Col>
          <Col sm={3}> {(projAvgWaitTimeSecs/60).toFixed(2)} </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Projected Abandonment Rate:
          </Col>
          <Col sm={2}> {Math.round(projections.abandonmentProb*100)} </Col>
          <Col sm={1}> % </Col>
        </Row>

        <Row>
          <hr />
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            # Concurrent Analysts Needed, Lower Bound:
          </Col>
          <Col sm={3}> {rawStaffLower} </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            # Total Analysts Needed, Lower Bound:
          </Col>
          <Col sm={3}> {staffForTrafficIntensity} </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Projected Average Wait Time (Minutes):
          </Col>
          <Col sm={3}> {(projAvgWaitTimeSecsLower/60).toFixed(2)} </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            Projected Abandonment Rate:
          </Col>
          <Col sm={2}> {Math.round(projectionsLower.abandonmentProb*100)} </Col>
          <Col sm={1}> % </Col>
        </Row>

        <Row>
          <hr />
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            For Current Staffing, Projected Average Wait Time (Minutes):
          </Col>
          <Col sm={3}> {projectionsCurrent.meanWaitingTime.toFixed(2)} </Col>
        </Row>

        <Row>
          <Col className="model-chart-label" sm={9}>
            For Current Staffing, Projected Abandonment Rate:
          </Col>
          <Col sm={2}> {Math.round(projectionsCurrent.abandonmentProb*100)} </Col>
          <Col sm={1}> % </Col>
        </Row>


      </Container>
    )
  }
}

export default ModelChart;
