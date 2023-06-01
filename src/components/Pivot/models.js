import erlangC from './erlangc';
import erlangA from './erlangA';
import metadata from './metadata';
import utils from './utils';
import transforms from './transforms';

const fn = () => {

  // Return metadata.
  //
  const getMeta = () => {
    return {
      // analyst: '# ' + metadata.getAlias('Target Name'),
      // role: '# ' + metadata.getAlias('ticketSummary_Role'),
      // analyst: metadata.getAlias('Target Name'),
      analyst: metadata.getAlias('analyst'),
      role: metadata.getAlias('ticketSummary_Role'),

      daysWorkedField: metadata.getAlias('ticketSummary_daysWorkPerCall'),
      calls: metadata.getAlias('# Records'),
      waitHours: metadata.getAlias('waitHours'),
      handleTimeCalculated: metadata.getAlias('handleSecs'),
      handleTime: metadata.getAlias('TOTAL EDIT TIME'),
      handleTimeRaw: metadata.getAlias('workHours'),
      handleTimeRaw100: metadata.getAlias('workHours_100'),
      talkHours: metadata.getAlias('talkHours'),

      abandonedCallsRegular: metadata.getAlias('abandoned_regular_total'),
      abandonedCallsNW: metadata.getAlias('abandoned_nw_total'),

      abandonedCallsRegularMonth: metadata.getAlias('abandoned_regular_month'),
      abandonedCallsNWMonth: metadata.getAlias('abandoned_nw_month'),

      month: metadata.getAlias('month'),

      balkPercent: metadata.getDatasetAttr('balkPercent'),
  
      nightWeekend: {
        role: ['N/W', 'NITE'],  // Name of night/weekend categorical value
        onlyWeek: 'week', // If only regular workers ("weekly") are included
        onlyNW: 'nw',   // If only night/weekend workers are included
        both: 'both', // If both kinds of workers are included
      }
    };
  }
  
  // Given a vector of months, return the total # of working days in those months
  //
  const getWorkdays = months => {
    return Array.isArray(months) ? months.reduce((i, j) => {
      const mmyy = j.split('/');
      const days = utils.getWorkdaysInMonth(mmyy[0], mmyy[1]);

      return i + days;
    }, 0) : 0;
  }

  // Given a vector of months, return the total # of days in those months
  //
  const getDays = months => {
    return Array.isArray(months) ? months.reduce((i, j) => {
      const mmyy = j.split('/');
      const days = utils.getDaysInMonth(mmyy[0], mmyy[1]);

      return i + days;
    }, 0) : 0;
  }

  // Return the average wait time, using Erlang C model
  //
  const getAverageWaitTimeErlangC = (calls, periodMinutes, averageHandleTime, nAgents,
      shifts, desiredAnalystUtilization) => {
    if (!utils.isNumeric(nAgents)) {
      return Infinity;
    }
    const rawWaitTime = erlangC.AverageSpeedOfAnswer(nAgents, calls, periodMinutes, averageHandleTime);

    return Math.round(rawWaitTime * 60);
  }

  // Find the # of staff to handle 'calls' over period of time 'period',
  // with average call time 'averageHandleTime',
  // and with 'serviceLevel' probability of service (e.g. .9 for 90%) within 'targetTime'.
  //
  // 'targetTime' may be 0, if we want to model how many agents we need for no waiting
  // with 'serviceLevel' probability.
  //
  // calls/period, averageHandleTime, and targetTime can be in minutes,
  // but really they can be any time period, as long as they are the
  // *same* time period.
  //
  const getOptimalStaffFromModel = (callsPerMinute, averageHandleTime, desiredServiceLevel,
      targetTime, patience, model) => {
    const maxAgents = 500;  // sooner or later we run out of budget :)
    const trafficIntensity = erlangC.TrafficIntensity(callsPerMinute, averageHandleTime);
    // const begin = Math.ceil(trafficIntensity);
    const begin = 1;

    // Always assume that we need more agents than the traffic intensity.  The
    // functions work when agents < begin, but they have ugly values and aren't useful.
    //
    for (var agents=begin; agents<=maxAgents; agents++) {
      const serviceLevel = getServiceLevel(agents, callsPerMinute, averageHandleTime, 
          targetTime, patience, model);

      if (serviceLevel > desiredServiceLevel) {           
        return agents;
      }
    }       

    return 'More than 500';
  }

  // Traffic intensity is call arrival rate, times averageHandleTime.
  // Calculate
  //   1 - probOfWaiting * e ** (-1 * (agents - trafficIntensity) * (targetTime / averageHandleTime))
  // which is the service level at targetTime.
  //
  // Note that the entire right hand term is 1 if targetTime is 0.
  //
  const getServiceLevel = (agents, callsPerMinute, averageHandleTime, targetTime, patience, model) => {
    const probOfWaiting = getProbOfWaiting(agents, callsPerMinute, averageHandleTime, patience, model);
    const trafficIntensity = erlangC.TrafficIntensity(callsPerMinute, averageHandleTime);
    const nMinusA = agents - trafficIntensity;

    return (1 - probOfWaiting * Math.pow(Math.E, -1 * nMinusA * (targetTime / averageHandleTime)));
  }

  // Return probability of waiting, using 'model'
  //
  const getProbOfWaiting = (agents, callsPerMinute, averageHandleTime, patience, model) => {
    const trafficIntensity = erlangC.TrafficIntensity(callsPerMinute, averageHandleTime);
    switch (model) {
      case 'erlangA': {
        // const basicStaff = Math.ceil(trafficIntensity);
        // const n = basicStaff; // * 1.5;
        const n = agents;
        const lam = callsPerMinute;
        const mu = 1 / averageHandleTime;  // reciprocal of average handle time, called "service rate"

        const theta = 1 / patience;
        const eaObj = erlangA.ErlangA(n, lam, mu, theta);
        return eaObj ? erlangA.waitingProbability(eaObj.axy, eaObj.pn) : Infinity;
      }
      case 'erlangC': {
        return erlangC.ErlangC(agents, trafficIntensity);
      }
      default: {
        return null;
      }
    }
  }

  // Return various projections, using Erlang A model.
  //
  const getProjections = (agents, calls, periodMinutes, averageHandleTime, patience, trafficIntensity) => {
    const n = agents < 1 ? 1 : agents;
    const lam = calls / periodMinutes;  // arrival rate
    const mu = 1 / averageHandleTime;  // reciprocal of average handle time, called "service rate"
    const theta = 1 / patience;

    const eaObj = erlangA.ErlangA(n, lam, mu, theta);
    const waitingProb = erlangA.waitingProbability(eaObj.axy, eaObj.pn);
    const abandonmentProbIfDelayed = erlangA.abandonProbIfDelayed(eaObj.rho, eaObj.axy);
    const abandonmentProb = erlangA.abandonmentProbability(eaObj.rho, eaObj.axy, eaObj.pn);
    const meanWaitingTime = erlangA.meanWaitingTime(eaObj.rho, eaObj.axy, eaObj.pn, theta);
    const meanWaitingIfDelayed = erlangA.meanWaitingIfDelayed(theta, eaObj.rho, eaObj.axy);
    const avgQueueLen = erlangA.avgQueueLen(lam, eaObj.rho, eaObj.axy, eaObj.pn, theta);
    const throughput = erlangA.getThroughput(n, mu, lam, eaObj.rho, eaObj.axy, eaObj.pn);
    const pn = erlangA.getPN(n, eaObj.ti, eaObj.axy);
    return {abandonmentProb, abandonmentProbIfDelayed, waitingProb, meanWaitingTime, meanWaitingIfDelayed,
        avgQueueLen, throughput, pn};
  }

  const getStaffAfterShiftAndUtilization = (n, shifts, desiredAnalystUtilization) => {
    const withShifts = n * shifts;
    const withUtilization = withShifts / (desiredAnalystUtilization/100);

    return Math.round(withUtilization);
  }

  // Return the average percentage of a work day that the average analyst in this
  // model is not handling calls.
  //
  const getShrinkageFromData = (data, loadComparisonData, workingDays) => {
    const meta = getMeta();
    const aggregateLoadFraction = getAggregateLoadFraction(loadComparisonData);

    const handleTime = data[meta.handleTime];  // in seconds, from TOTAL EDIT TIME
    const talkSecs = data[meta.talkHours] * 60 * 60;

    const totalDaysWorked = data[meta.daysWorkedField];
    const calls = data[meta.calls];
    const analysts = data[meta.analyst];

    // The actual analyst load is the percentage of regular working days that the analysts
    // actually worked.  For example, if an analyst worked 7 days in a quarter,
    // the number will be about 7 / 63.
    //
    const actualAnalysts = getActualAnalysts(totalDaysWorked, workingDays);
    const handleTimePerAnalyst = handleTime / actualAnalysts / 3600;  // in hours
    const dailyHandleTimePerAnalyst = (handleTimePerAnalyst / workingDays);

    // Shrinkage gets worse if there is a load change.  Adjust for that.
    //
    const handleTimeAfterLoad = dailyHandleTimePerAnalyst / aggregateLoadFraction;

    return getShrinkage(handleTimeAfterLoad);
  }

  const getShrinkage = dailyHandleTimePerAnalyst => {
    const first = 1 - dailyHandleTimePerAnalyst / 8;
    const second = first < 0 ? 0 : first;

    return second > 1 ? 1 : second;
  }

  const getActualAnalysts = (totalDaysWorked, workingDays) => {
    return totalDaysWorked / workingDays;
  }

  // Return the night/weekend state of the data:
  //   onlyWeek: 'week', // If only regular workers ("weekly") are included
  //   onlyNW: 'nw',   // If only night/weekend workers are included
  //   both: 'both', // If both kinds of workers are included
  //
  const getNightWeekendState = data => {
    const meta = getMeta();
    const roles = getRoles(data);

    return roles.reduce((i, j) => {
      if (meta.nightWeekend.role.includes(j)) {
        return i === null ? meta.nightWeekend.onlyNW : meta.nightWeekend.both;
      } else {
        return i === null || i === meta.nightWeekend.onlyWeek ?
            meta.nightWeekend.onlyWeek : meta.nightWeekend.both;
      }
    }, null);
  }

  // Return list of roles in the data
  //
  const getRoles = data => {
    const meta = getMeta();
    const fieldName = meta.role;  // locates 'Analyst Role:<ROLE>'
  
    return Object.keys(data).filter(i => {
      const catVar = i.split(':')[0];
      const catVal = i.split(':')[1];

      return catVar === fieldName && catVal;
    }).map(i => {
      return i.split(':')[1];
    });
  }

  // Return the # of minutes within this period.  This varies, depending on whether
  // we are doing 24x7 or regular working days.
  //
  const getPeriodMinutes = (nightWeekendState, days, workingDays) => {
    const meta = getMeta();
    switch (nightWeekendState) {
      case meta.nightWeekend.both: {
        return days * 24 * 60;
      }
      case meta.nightWeekend.onlyWeek: {
        return workingDays * 16 * 60;
      }
      default: {
        const weekendDays = days - workingDays;

        return (workingDays * 8 + weekendDays * 24) * 60;
      }
    }
  }

  // Return the # of shifts supported.  This depends on whether we are doing
  // 24/7, 16/5, or just night/weekend.  The result is the # of shifts in a day,
  // normalized to a 5-day workweek (which is the "typical" way that an analyst works).
  //
  // If we take 24/7 operation, then the # of shifts 3 * (7/5), because there
  // are 3 shifts in a day, and there are also 3 shifts across 2 weekend days.
  //
  // If we take 16/5 operation, then the # of shifts is just 2.
  //
  const getShifts = nightWeekendState => {
    const meta = getMeta();
    switch (nightWeekendState) {
      case meta.nightWeekend.both: {
        return +((3 * (7/5)).toFixed(2));
      }
      case meta.nightWeekend.onlyWeek: {
        return 2;
      }
      default: {
        return (5 + (3*2)) / 5;  // 5 night shifts, 3 shifts across weekend,
                                 // normalized to 5-day workweek
      }
    }

    return nightWeekendState === meta.nightWeekend.both ? +(3 * (7/5)).toFixed(2) :
      (nightWeekendState === meta.nightWeekend.onlyWeek ? 2 : null);
  }

  const getAbandonment = (nightWeekendState, abandonmentRegular, abandonmentNW) => {
    const meta = getMeta();
    switch (nightWeekendState) {
      case meta.nightWeekend.both: {
        return abandonmentRegular + abandonmentNW;
      }
      case meta.nightWeekend.onlyWeek: {
        return abandonmentRegular;
      }
      default: {
        return abandonmentNW;
      }
    }

    return nightWeekendState === meta.nightWeekend.both ? +(3 * (7/5)).toFixed(2) :
      (nightWeekendState === meta.nightWeekend.onlyWeek ? 2 : null);
  }

  // Return the fraction of the data that was reduced due to applying load factors.
  //
  const getAggregateLoadFraction = loadComparisonData => {
    const meta = getMeta();
    if (!loadComparisonData ||
        !loadComparisonData.hasOwnProperty(meta.handleTimeRaw) ||
        !loadComparisonData.hasOwnProperty(meta.handleTimeRaw100)) return 1;

    const loaded = loadComparisonData[meta.handleTimeRaw];
    const orig = loadComparisonData[meta.handleTimeRaw100];
    if (!utils.isNumeric(orig) || !utils.isNumeric(loaded) || orig == 0) return 1;

    return loaded / orig;
  }

  const getTrafficIntensity = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }

    // Note that we use monthly abandonment: this function is only used
    // for monthly datapoints.
    //
    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];

    const months = [data[meta.month]];
    const days = getDays(months);
    const workingDays = getWorkdays(months);

    const nightWeekendState = getNightWeekendState(data);

    const calls = data[meta.calls];

    const handleTime = data[meta.handleTime];  // in seconds

    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const averageHandleTime = handleTime / calls / 60;  // in minutes

    const periodMinutes = getPeriodMinutes(nightWeekendState, days, workingDays);
    const callsPerMinute = totalCalls / periodMinutes;

    return erlangC.TrafficIntensity(callsPerMinute, averageHandleTime);
  }

  const getUtilization = (rec, daysWorkField, handlingTimeSecsField) => {
    const daysWork = utils.isNumeric(rec[daysWorkField]) ? rec[daysWorkField] : 0;
    const handlingTimeSecs = utils.isNumeric(rec[handlingTimeSecsField]) ? rec[handlingTimeSecsField] : 0;

    // Convert both times to hours.
    // Note that daysWork is in 8-hour (shift) days, not 24-hour days.
    //
    const handlingTimeHours = handlingTimeSecs / 3600;
    const daysWorkHours = daysWork * 8;
    return daysWorkHours === 0 ? 0 : handlingTimeHours / daysWorkHours;
  }

  const getArrivalRate = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }

    const months = [data[meta.month]];
    const days = getDays(months);
    const workingDays = getWorkdays(months);
    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];

    const nightWeekendState = getNightWeekendState(data);

    const totalDaysWorked = data[meta.daysWorkedField];

    const calls = data[meta.calls];
    const waitHours = data[meta.waitHours];
    const analysts = data[meta.analyst];

    const handleTime = data[meta.handleTime];  // in seconds
    const talkSecs = data[meta.talkHours] * 60 * 60;

    const avgWaitTimeMinutesPerCall = (waitHours * 60) / calls;

    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const periodMinutes = getPeriodMinutes(nightWeekendState, days, workingDays);
    const arrivalRate = totalCalls / periodMinutes;
    return arrivalRate;
  }

  const getDailyHandlingTimePerAnalyst = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.month)) {
      return null;
    }

    const months = [data[meta.month]];
    const workingDays = getWorkdays(months);
    const totalDaysWorked = data[meta.daysWorkedField];
    const handleTime = data[meta.handleTime];  // in seconds
    const actualAnalysts = getActualAnalysts(totalDaysWorked, workingDays);
    const handleTimePerAnalyst = handleTime / actualAnalysts / 3600;  // in hours
    const dailyHandleTimePerAnalyst = (handleTimePerAnalyst / workingDays);
    return dailyHandleTimePerAnalyst;
  }

  const getAverageHandleTimePerCall = data => {
    const meta = getMeta();

    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }

    const calls = data[meta.calls];
    const handleTime = data[meta.handleTime];  // in seconds
    const averageHandleTime = handleTime / calls / 60;  // in minutes
    return averageHandleTime;
  }

  const getConcurrentWorkingAnalysts = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.month)) {
      return null;
    }
 
    const months = [data[meta.month]];
    const workingDays = getWorkdays(months);
    const nightWeekendState = getNightWeekendState(data);
    const shifts = getShifts(nightWeekendState);
    const totalDaysWorked = data[meta.daysWorkedField];
    const loadComparisonData = transforms.getLoadComparisonData([data]);

    const shrinkage = Math.round(getShrinkageFromData(data, loadComparisonData, workingDays) * 100);
    const desiredAnalystUtilization = 100 - shrinkage;

    const actualAnalysts = getActualAnalysts(totalDaysWorked, workingDays);
    const utilization = desiredAnalystUtilization / 100; 
    const workingAnalysts = (actualAnalysts * utilization) / shifts;
    return workingAnalysts;
  }

  const getAnalystAggregateUtilization = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.month)) {
      return null;
    }
 
    const months = [data[meta.month]];
    const workingDays = getWorkdays(months);
    const loadComparisonData = transforms.getLoadComparisonData([data]);

    const shrinkage = Math.round(getShrinkageFromData(data, loadComparisonData, workingDays) * 100);
    return 100 - shrinkage;
  }

  // Return abandonment rate as a percentage
  //
  const getAbandonmentRate = data => {
    const meta = getMeta();

    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }

    const nightWeekendState = getNightWeekendState(data);

    const calls = data[meta.calls];

    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];

    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const abandonmentRate = abandonedCalls / totalCalls;
    return abandonmentRate * 100;
  }

  const getPatience = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }

    const calls = data[meta.calls];
    const waitHours = data[meta.waitHours];
    const avgWaitTimeMinutesPerCall = (waitHours * 60) / calls;

    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];

    const nightWeekendState = getNightWeekendState(data);
    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const abandonmentRate = abandonedCalls / totalCalls;

    const patience = avgWaitTimeMinutesPerCall / abandonmentRate;
    return patience;
  }

  const getAnalystsAdjustedForDaysWorked = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.month)) {
      return null;
    }
 
    const months = [data[meta.month]];
    const workingDays = getWorkdays(months);
    const totalDaysWorked = data[meta.daysWorkedField];

    const actualAnalysts = getActualAnalysts(totalDaysWorked, workingDays);
    return actualAnalysts;
  }

  const getConcurrentAnalystsNeededUpperBound = data => {
const probAnsweringWithinOnHold = 80;   // FIXME!!!  This should come from the labor model inputs
const onHoldTime = 30;                  // FIXME!!!  This should come from the labor model inputs
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }
    const months = [data[meta.month]];
    const days = getDays(months);
    const workingDays = getWorkdays(months);

    const nightWeekendState = getNightWeekendState(data);
    const totalDaysWorked = data[meta.daysWorkedField];

    const calls = data[meta.calls];

    const handleTime = data[meta.handleTime];  // in seconds

    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];

    const waitHours = data[meta.waitHours];
    const avgWaitTimeMinutesPerCall = (waitHours * 60) / calls;

    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;

    const averageHandleTime = handleTime / calls / 60;  // in minutes

    const periodMinutes = getPeriodMinutes(nightWeekendState, days, workingDays);
    const serviceLevel = probAnsweringWithinOnHold / 100;  // in percentage
    const targetTime = onHoldTime / 60;  // in minutes

    const callsPerMinute = totalCalls / periodMinutes;
    const abandonmentRate = abandonedCalls / totalCalls;

    const patience = avgWaitTimeMinutesPerCall / abandonmentRate;

    const rawStaff = getOptimalStaffFromModel(callsPerMinute, averageHandleTime, serviceLevel,
        targetTime, patience, 'erlangA');
    return rawStaff;
  }

  const getTotalAnalystsNeededUpperBound = data => {
    const meta = getMeta();
    const rawStaff = getConcurrentAnalystsNeededUpperBound(data);
    if (rawStaff === null) {
      return null;
    }

    const months = [data[meta.month]];
    const nightWeekendState = getNightWeekendState(data);
    const shifts = getShifts(nightWeekendState);
    const loadComparisonData = transforms.getLoadComparisonData([data]);
    const workingDays = getWorkdays(months);
    const shrinkage = Math.round(getShrinkageFromData(data, loadComparisonData, workingDays) * 100);
    const desiredAnalystUtilization = 100 - shrinkage;

    const optimalStaffErlangA = getStaffAfterShiftAndUtilization(rawStaff, shifts,
        desiredAnalystUtilization);
    return optimalStaffErlangA;
  }

  // Return projected wait time in minutes
  //
  const getProjectionsObj = data => {
    const meta = getMeta();
    if (!data.hasOwnProperty(meta.calls)) {
      return null;
    }
    const rawStaff = getConcurrentAnalystsNeededUpperBound(data);
    if (rawStaff === null) {
      return null;
    }
    if (!data.hasOwnProperty(meta.abandonedCallsRegularMonth) ||
        !data.hasOwnProperty(meta.abandonedCallsNWMonth)) {
      return null;
    }
    const calls = data[meta.calls];
    const months = [data[meta.month]];
    const days = getDays(months);
    const workingDays = getWorkdays(months);
    const nightWeekendState = getNightWeekendState(data);

    const periodMinutes = getPeriodMinutes(nightWeekendState, days, workingDays);

    const handleTime = data[meta.handleTime];  // in seconds
    const averageHandleTime = handleTime / calls / 60;  // in minutes

    const waitHours = data[meta.waitHours];
    const avgWaitTimeMinutesPerCall = (waitHours * 60) / calls;
    const abandonedCallsRegular = data[meta.abandonedCallsRegularMonth];
    const abandonedCallsNW = data[meta.abandonedCallsNWMonth];
    const abandonedCalls =
        getAbandonment(nightWeekendState, abandonedCallsRegular, abandonedCallsNW);
    const totalCalls = calls + abandonedCalls;
    const abandonmentRate = abandonedCalls / totalCalls;
    const patience = avgWaitTimeMinutesPerCall / abandonmentRate;

    const trafficIntensity = getTrafficIntensity(data);

    return getProjections(rawStaff, totalCalls, periodMinutes,
        averageHandleTime, patience, trafficIntensity);
  }

  const getProjectedWaitTime = data => {
    const projections = getProjectionsObj(data);
    return projections ? projections.meanWaitingTime : null;
  }

  const getProjectedAbandonmentRate = data => {
    const projections = getProjectionsObj(data);
    return projections ? projections.abandonmentProb * 100 : null;
  }

  const getConcurrentAnalystsNeededLowerBound = data => {
    return Math.ceil(getTrafficIntensity(data));
  }

  const getTotalAnalystsNeededLowerBound = data => {
    const meta = getMeta();
    const rawStaffLower = getConcurrentAnalystsNeededLowerBound(data);

    const nightWeekendState = getNightWeekendState(data);
    const shifts = getShifts(nightWeekendState);

    const loadComparisonData = transforms.getLoadComparisonData([data]);
    const months = [data[meta.month]];
    const workingDays = getWorkdays(months);
    const shrinkage = Math.round(getShrinkageFromData(data, loadComparisonData, workingDays) * 100);
    const desiredAnalystUtilization = 100 - shrinkage;

    const staffForTrafficIntensity = models.getStaffAfterShiftAndUtilization(rawStaffLower,
        shifts, desiredAnalystUtilization);
    return staffForTrafficIntensity;
  }

  return {
    getMeta,
    getWorkdays,
    getDays,
    getAverageWaitTimeErlangC,
    getOptimalStaffFromModel,
    getServiceLevel,
    getProbOfWaiting,
    getProjections,
    getStaffAfterShiftAndUtilization,
    getShrinkageFromData,
    getShrinkage,
    getActualAnalysts,
    getNightWeekendState,
    getPeriodMinutes,
    getShifts,
    getAbandonment,
    getAggregateLoadFraction,
    getTrafficIntensity,
    getUtilization,
    getArrivalRate,
    getDailyHandlingTimePerAnalyst,
    getAverageHandleTimePerCall,
    getConcurrentWorkingAnalysts,
    getAnalystAggregateUtilization,
    getAbandonmentRate,
    getPatience,
    getAnalystsAdjustedForDaysWorked,
    getConcurrentAnalystsNeededUpperBound,
    getTotalAnalystsNeededUpperBound,
    getConcurrentAnalystsNeededLowerBound,
    getTotalAnalystsNeededLowerBound,
    getProjectedWaitTime,
    getProjectedAbandonmentRate,
  }
};

const models = fn();

export default models;
