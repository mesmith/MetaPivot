import React from 'react';
import metadata from './metadata';

// Implement the React summary table
//
class SummaryChart extends React.Component {
  render(){
    const { data } = this.props;

    const allowed = metadata.getColumnsWithAttrTrue('summary').reduce((i, j) => {
      return {...i, ...{[j]: true}};
    }, {});

    // This will generate the name of a metadata variable used to
    // count a 'summary' categorical variable.  The new variable's name is derived
    // from the alias of the 'summary' variable:  its name will be
    // '# <summary-variable-alias-name>'.
    //
    const cats = metadata.getCategoricals().filter(i => {
      return allowed.hasOwnProperty(i);
    }).reduce((i, j) => {
      return {...i, ...{['# ' + metadata.getAlias(j)]: true}};
    }, {});

    const numerics = metadata.getNumerics().filter(i => {
      return allowed.hasOwnProperty(i);
    }).reduce((i, j) => {
      return {...i, ...{[metadata.getAlias(j)]: true}};
    }, {});

    // The summary data consists of:
    // - values whose names are '# <cat variable>'
    // - values whose names are '# <cat variable>:<cat value>'
    // - values whose names are 'numeric variable'
    //
    // We apply these filters:
    // - We don't want to see the '# <cat variable>:<cat value>' variables.
    // - We only want to see data with metadata marked as "summary".
    //
    const list = Object.keys(data).sort().filter(i => {
      return cats.hasOwnProperty(i) || numerics.hasOwnProperty(i);
    }).map(i => {
      const value = !numerics[i] || Number.isInteger(data[i]) ?
          data[i] : data[i].toFixed(2);

      return {name: i, value};
    });
    const showClass = this.props.show ? 'chartShow' : 'chartNone';

    return (
      <div className={"summary-chart pivot-div " + showClass}>
        <h2>Chart Totals</h2>
        <ul className="summary-table">
         {Array.isArray(list) ? list.map(i => {
           return (
             <li key={i.name} className="summary-chart-item">
               <label className="summary-chart-label">{i.name}:</label>
               <label className="summary-chart-value">{i.value}</label>
             </li>);
         }) : null}
        </ul>
      </div>
    )
  }
}

export default SummaryChart;
