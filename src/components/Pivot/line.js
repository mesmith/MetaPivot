// line/bubble drawing functions
//
// Turning off eslint warnings:
/* global d3 */
//
import utils from './utils.js';
import tooltip from './tooltip.js';
import metadata from './metadata.js';
import forcelabel from './forcelabel.js';
import controls from './controls.js';
import config from './config.js';
import time from './time.js';
const { d3config } = config;

const duration = 1500;

const line = function(){

  // Default line color.  A multiline plot will add to this.
  //
  const defaultColor = '#ddd';

  // Called when we mouse over or out of a data element 'elt'.
  //
  function onMouseover(elt, newConfig){ 
    d3.select(elt).transition().duration(newConfig.transition)
        .style("fill", newConfig.hoverColor);
  }
  function onMouseout(elt, axes, newConfig){ 
    d3.select(elt).transition().duration(newConfig.transition)
      .style("fill", function(d) {
        return newConfig.cScale(utils.safeVal(d, axes.colorAxis));
      });
  }

  // Create the data-independent aspect of the line/bubble chart
  //
  function create(parent, newConfig){
    const bottom = newConfig.HEIGHT - newConfig.MARGINS.bottom;
    const left = newConfig.MARGINS.innerleft;
    const right = newConfig.WIDTH - newConfig.MARGINS.right;
    const top = newConfig.MARGINS.top;

    // add in the x axis
    //
    d3.select(parent).append("svg:g")
      .attr("class", "x axis") // so we can style it with CSS
      .attr("transform", "translate(0," + bottom + ")")
      .call(newConfig.xAxis); // add to the visualization

    d3.select(parent).append("line")
      .attr("x1", left)
      .attr("x2", right)
      .attr("y1", bottom)
      .attr("y2", bottom)
      .style("stroke", "#fff")

    // Label for X axis
    //
    d3.select(parent).append("text")
      .attr("class",  "x label")
      .attr("text-anchor", "end")
      .attr("x", right)
      .attr("y", bottom - 6)
      .text("");

    // add in the y axis
    //
    d3.select(parent).append("svg:g")
      .attr("class", "y axis") // so we can style it with CSS
      .attr("transform", "translate(" + left + ", 0)")
      .call(newConfig.yAxis); // add to the visualization
    d3.select(parent).append("line")
      .attr("x1", left)
      .attr("x2", left)
      .attr("y1", top)
      .attr("y2", bottom)
      .style("stroke", "#fff");

    // Label for Y axis
    //
    d3.select(parent).append("text")
      .attr("class", "y label")
      .attr("text-anchor", "end")
      .attr("x", -top)
      .attr("y", left + 2)
      .attr("dy", ".75em")
      .attr("transform", "rotate(-90)")
      .text("");

    // No data label.
    //
    d3.select(parent).append("text")
      .attr("class", "nodata label")
      .attr("text-anchor", "middle")
      .attr("y", d3config.HEIGHT/2)
      .attr("x", d3config.WIDTH/2)
  }

  // This redraws a bubble chart ("scatterplot")
  //
  function redrawBubble(parent, forceLabels, drawingData, withLine,
      tooltipPivots, datapointCol, axes, newConfig, loading, markers){

    // remove data from previously drawn vizes
    //
    if( !withLine ) clear(parent, newConfig);

    const xAlias = axes.xAxis;
    const yAlias = axes.yAxis;
    const validDrawingData = drawingData.filter(i => i.hasOwnProperty(xAlias) && i.hasOwnProperty(yAlias));

    // This will set the key for each datapoint, so animation
    // has the 'constancy' property
    //
    const datapointAlias = metadata.getAlias(datapointCol);
    const noLabel = metadata.getDatasetAttr('noLabel');
    const datapoints = d3.select(parent).selectAll(".bubble")
        .data(validDrawingData, d => d[datapointAlias]);
    const yDomainZero = metadata.getDatasetAttr('yDomainZero');

    // We need to use any multiline specifications to calculate the max
    // Y coordinate.
    //

    const yColumn = metadata.aliasToColumn(yAlias);
    const multiline = metadata.getAttrValue(yColumn, 'multiline', []);
    const otherCols = multiline.map(i => i.col);
    const allColors = [defaultColor].concat(multiline.map(i => i.color));
    const series = getSeries(xAlias, yAlias, otherCols, allColors, validDrawingData);
    const flatSeries = series.map(i => i.p).flat();
    const markerSeries = getMarkerSeries(markers);

    // The data domains or desired axes might have changed, so update them all.
    // Set these before doing enter(), so we see a nice entry transition.
    //
    setXDomain(newConfig, flatSeries.concat(markerSeries));
    setYDomain(newConfig, flatSeries, yDomainZero);

    newConfig.cScale.domain([
      utils.getSafe(d3.min, validDrawingData, d => utils.safeVal(d, axes.colorAxis)),
      utils.getSafe(d3.max, validDrawingData, d => utils.safeVal(d, axes.colorAxis))
    ]);

    // add new points if they're needed
    //
    datapoints.enter()
      .insert("svg:circle")
        .attr("cx", d => newConfig.xScale(utils.safeVal(d, axes.xAxis)))
        .attr("cy", d => newConfig.yScale(utils.safeVal(d, axes.yAxis)))
        .attr("r", function() { return 0; })
        .attr("class", "bubble")
        .style("fill", d => newConfig.cScale(utils.safeVal(d, axes.colorAxis)))
        .style("stroke-width", 1.5)
        .style("opacity", 1)

    if( withLine ){  // This makes a tiny data-point, rather than a bubble
      newConfig.rScale.domain([1, 1]);
    } else {
      setDomain(newConfig.rScale, validDrawingData, axes.radiusAxis, false);
    }

    // transition the axes output format, depending on whether the data 
    // is in units or in time
    //
    newConfig.xAxis.tickFormat(metadata.getAxisFormat(axes.xAxis), 1);
    newConfig.yAxis.tickFormat(metadata.getAxisFormat(axes.yAxis), 1);

    // transition function for the axes
    //
    const t = 
        d3.select(parent).transition().duration(duration).ease("exp-in-out");
    t.select(".x.axis").call(newConfig.xAxis);
    t.select(".x.label").text(axes.xAxis);
    t.select(".y.axis").call(newConfig.yAxis);
    t.select(".y.label").text(axes.yAxis);
    t.select(".date.label").text('');
    t.select(".nodata.label").text(validDrawingData.length === 0 ? 'No Data' : '');

    // Erase current labels.
    //
    if (!loading || validDrawingData.length === 0) {
      forcelabel.clear(forceLabels, axes, newConfig);
    }

    // Transition the points.  When the circles are drawn,
    // draw the labels on top of them.
    //
    const nCircle = validDrawingData.length;
    datapoints
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 1)
      .style("fill", d => newConfig.cScale(utils.safeVal(d, axes.colorAxis)))
      .style("stroke",  function(d) {
        return d3
          .rgb(newConfig.cScale(utils.safeVal(d, axes.colorAxis)))
          .darker(2);
      })
      .attr("r", d => newConfig.rScale(utils.safeVal(d, axes.radiusAxis)))
      .attr("cx", d => newConfig.xScale(utils.safeVal(d, axes.xAxis)))
      .attr("cy", d => newConfig.yScale(utils.safeVal(d, axes.yAxis)))
      .each("end", function(d, i){
        if (!noLabel && i==nCircle-1 && !loading){
          forcelabel.redraw(forceLabels, validDrawingData, duration, 
              datapointCol, axes, newConfig);

          // We must set this now, not at enter time;
          // otherwise the closure on the axes variable at enter time
          // will take precendence and draw the wrong fill color on mouseout.
          //
          datapoints
            .on("mouseover", function(){onMouseover(this, newConfig);})
            .on("mouseout", function(){onMouseout(this, axes, newConfig);})
        }
      })

    // remove points if we don't need them anymore
    //
    datapoints.exit()
      .transition().duration(duration).ease("exp-in-out")
      .each("start", function() {  // Use this to do static label placement
      })
      .attr("cx", d => newConfig.xScale(utils.safeVal(d, axes.xAxis)))
      .attr("cy", d => newConfig.yScale(utils.safeVal(d, axes.yAxis)))
      .style("opacity", 0)
      .attr("r", 0)
        .remove();


    // Add tooltip to the element.
    // Tooltip title is always the datapoint representation.
    //
    tooltip.doTooltip(tooltipPivots, datapointCol, 'bubble');
  }

  // Redraw a line chart
  //
  function redraw(parent, forceLabels, drawingData, tooltipPivots, 
      datapointCol, axes, newConfig, loading, markers){

    const xAlias = axes.xAxis;
    const yAlias = axes.yAxis;
    const validDrawingData = drawingData.filter(i => i.hasOwnProperty(xAlias) && i.hasOwnProperty(yAlias));

    const yDomainZero = metadata.getDatasetAttr('yDomainZero');

    // This does an in-place sort.  It's needed so the lines are
    // drawn in x-order.
    //
    validDrawingData.sort(function(a, b){
      return utils.safeVal(a, xAlias) - utils.safeVal(b, xAlias);
    })
    const yColumn = metadata.aliasToColumn(yAlias);
    const multiline = metadata.getAttrValue(yColumn, 'multiline', []);
    const otherCols = multiline.map(i => i.col);
    const allColors = [defaultColor].concat(multiline.map(i => i.color));
    const series = getSeries(xAlias, yAlias, otherCols, allColors, validDrawingData);

    // transition the axes output format, depending on whether the data 
    // is in units or in time (or any other useful human readable format)
    //
    newConfig.xAxis.tickFormat(metadata.getAxisFormat(xAlias), 1);
    newConfig.yAxis.tickFormat(metadata.getAxisFormat(yAlias), 1);

    // Establish the domains for the axes.
    //
    // Note that, for multiline, we can't rely on just 'validDrawingData'; instead,
    // use all of the Y values from the entire series.
    //
    // And we include the X (time) data to set the X domain for any markers.
    //
    const flatSeries = series.map(i => i.p).flat();
    const markerSeries = getMarkerSeries(markers);
    setXDomain(newConfig, flatSeries.concat(markerSeries));
    setYDomain(newConfig, flatSeries, yDomainZero);

    // Transition the axes
    //
    const t = 
        d3.select(parent).transition().duration(duration).ease("exp-in-out");
    t.select(".x.axis").call(newConfig.xAxis);
    t.select(".x.label").text(xAlias);
    t.select(".y.axis").call(newConfig.yAxis);
    t.select(".y.label").text(yAlias);

    // Add the path for the line
    //
    const valueline = d3.svg.line()
      .x(d => newConfig.xScale(utils.safeVal(d, 'x')))
      .y(d => newConfig.yScale(utils.safeVal(d, 'y')))
      .interpolate("linear")
      ;

    // Bind the data.  It's an array of arrays; each sub-array represents
    // a single path.  Here, we only draw one path.
    //
    const pathSelection = d3.select(parent).selectAll("path.line")
      .data(series);

    pathSelection
      .enter()
      .append("path")
        .classed("line", true)
        .style("fill", "none")
        .style("stroke", "none")
        .style("opacity", 0)
        ;

    pathSelection
      .transition().duration(duration).ease("exp-in-out")
      .attr("d", d => valueline(d.p))
      .style("stroke", d => d.c)
      .style("opacity", 1)
      ;

    pathSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;

    // Legend
    //
    const colors = series.map(i => {
      return { name: i.name, color: i.c };
    });

    const legendRectWidth = 18;
    const legendRectHeight = 6;
    const legendSpacing = 4;
    const legendX = newConfig.WIDTH - 40;
    const legendY = 120;

    const legendRectSelection = d3.select(parent).selectAll("rect.legend")
      .data(colors);

    legendRectSelection
      .enter()
      .append("rect")
        .classed("legend", true)
        .attr("x", legendX)
        .attr("y", (_, i) => (legendY + (legendRectWidth - legendRectHeight)/2 + i * (legendRectWidth + legendSpacing)))
        .attr('width', legendRectWidth)
        .attr('height', legendRectHeight)
        .style('fill', d => d.color)
        .style('stroke', d => d.color)
        .style("opacity", 0)
        ;

    legendRectSelection
      .transition().duration(duration).ease("exp-in-out")
        .style("opacity", .9)
        .style('fill', d => d.color)
        .style('stroke', d => d.color)
      ;

    legendRectSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;

    const legendTextSelection = d3.select(parent).selectAll("text.legend")
      .data(colors);

    legendTextSelection
      .enter()
      .append("text")
        .classed("legend", true)
        .attr("x", legendX + legendRectWidth + legendSpacing)
        .attr("y", (_, i) => (legendY + (legendRectWidth/2) + i * (legendRectWidth + legendSpacing)))
        .attr("dominant-baseline", "central")
        .style("opacity", 0)
        ;

    legendTextSelection
      .transition().duration(duration).ease("exp-in-out")
        .style("opacity", .9)
        .text(d => d.name)
      ;

    legendTextSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;

    // Bind the markers.
    //
    const markerSelection = d3.select(parent).selectAll("line.marker")
      .data(markers);

    // Add the path for the marker
    //
    const bottom = newConfig.HEIGHT - newConfig.MARGINS.bottom;
    const top = newConfig.MARGINS.top;

    // Marker date lines.  Note that this assumes that the X axis
    // is for Dates.
    //
    markerSelection
      .enter()
      .append("line")
        .classed("marker", true)
        .attr("x1", d => newConfig.xScale(0))
        .attr("x2", d => newConfig.xScale(0))
        .attr("y1", top)
        .attr("y2", top)
        .attr("stroke-dasharray", 4)
        .style("stroke", "yellow")
        .style("opacity", 0);

    markerSelection
      .transition().duration(duration).ease("exp-in-out")
        .attr("x1", d => newConfig.xScale(time.isoToMS(d.date)))
        .attr("x2", d => newConfig.xScale(time.isoToMS(d.date)))
        .attr("y1", top)
        .attr("y2", bottom)
        .style("stroke", "yellow")
        .style("opacity", .5)
        ;

    markerSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
        .attr("x1", d => newConfig.xScale(0))
        .attr("x2", d => newConfig.xScale(0))
        .style("opacity", 0)
      ;

    // Marker labels
    //
    const markerTextSelection = d3.select(parent).selectAll("text.marker")
      .data(markers);

    markerTextSelection
      .enter()
      .append("text")
        .classed("marker", true)
        .attr("text-anchor", "end")
        .attr("x", -top)
        .attr("y", d => newConfig.xScale(time.isoToMS(d.date)) + 2)
        .attr("dy", ".75em")
        .attr("transform", "rotate(-90)")
        .style("opacity", 0)
        .text(d => d.name)
        ;

    markerTextSelection
      .transition().duration(duration).ease("exp-in-out")
        .attr("text-anchor", "end")
        .attr("x", -top)
        .attr("y", d => newConfig.xScale(time.isoToMS(d.date)) + 2)
        .attr("dy", ".75em")
        .attr("transform", "rotate(-90)")
        .style("opacity", .5)
        ;

    markerTextSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;

    // Draw the bubble chart on top of the lines,
    // so we can see the data point labels.  Note that we do *not*
    // draw bubbles for the multilines--only for the original data
    // in drawingData.
    //
    redrawBubble(parent, forceLabels, drawingData, /* withLine */ true, tooltipPivots, 
        datapointCol, axes, newConfig, loading, markers);
  }

  // Given a dataset, its Y alias value,
  // and its set of multiline columns,
  // return a dataset that can be used to plot the multiline data.
  //
  function getSeries(xAlias, yAlias, otherCols, allColors, drawingData) {
    const otherAliases = otherCols.map(i => metadata.getAlias(i));
    const allAliases = [yAlias].concat(otherAliases);
    return allAliases.map((i, n) => {
      const oneSeries = drawingData.map(j => {
        const x = utils.safeVal(j, xAlias);
        const y = utils.safeVal(j, i);
        return {x, y};
      });
      const color = allColors.length > n ? allColors[n] : defaultColor;
      return {name: i, p: oneSeries, c: color};
    });
  }

  // Return the list of markers in series format.
  //
  function getMarkerSeries(markers) {
    return Array.isArray(markers) ? markers.map(i => ({x: time.isoToMS(i.date)})) : [];
  }

  // Called when the <LineChart> is destroyed.  Do any cleanup here
  //
  function destroy(){
  }

  // Clear the previous line drawing
  //
  function clear(parent, d3config){
    const pathSelection = 
        d3.select(parent).selectAll("path.line").data([]);

    pathSelection
      .exit()
      .transition().duration(d3config.transition).ease("exp-in-out")
      .style("opacity", 0)

    const markerSelection = d3.select(parent).selectAll("line.marker")
      .data([]);

    markerSelection
      .exit()
      .transition().duration(d3config.transition).ease("exp-in-out")
        .attr("x1", d => d3config.xScale(0))
        .attr("x2", d => d3config.xScale(0))
        .style("opacity", 0)
        ;

    const markerTextSelection = d3.select(parent).selectAll("text.marker")
      .data([]);

    markerTextSelection
      .exit()
      .transition().duration(d3config.transition).ease("exp-in-out")
        .style("opacity", 0)
        .attr("x1", d => d3config.xScale(0))
        .attr("x2", d => d3config.xScale(0))
        ;

    const legendRectSelection = d3.select(parent).selectAll("rect.legend")
      .data([]);

    legendRectSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;

    const legendTextSelection = d3.select(parent).selectAll("text.legend")
      .data([]);

    legendTextSelection
      .exit()
      .transition().duration(duration).ease("exp-in-out")
      .style("opacity", 0)
      ;
  }

  // Clear previous bubble chart
  //
  function clearBubble(parent, d3config){
    const datapoints = 
        d3.select(parent).selectAll(".bubble").data([]);

    datapoints.exit()
      .transition().duration(d3config.transition).ease("exp-in-out")
      .attr("r", 0)
      .remove();
  }

  // Calculate the X axis domain, and set it in the d3 scale.
  //
  function setXDomain(newConfig, flatSeries) {
    return setDomain(newConfig.xScale, flatSeries, 'x', /* domainZero */ false);
  }

  // Calculate the Y axis domain, and set it in the d3 scale.
  //
  function setYDomain(newConfig, flatSeries, yDomainZero) {
    return setDomain(newConfig.yScale, flatSeries, 'y', yDomainZero);
  }

  function setDomain(scale, flatSeries, axis, domainZero) {
    if (domainZero) {
      const minDom = utils.getSafe(d3.min, flatSeries, d => utils.safeVal(d, axis));
      scale.domain(utils.getMinRange([
        minDom < 0 ? minDom : 0,
        utils.getSafe(d3.max, flatSeries, d => utils.safeVal(d, axis))
      ]));
    } else {
      scale.domain(utils.getMinRange([
        utils.getSafe(d3.min, flatSeries, d => utils.safeVal(d, axis)),
        utils.getSafe(d3.max, flatSeries, d => utils.safeVal(d, axis)
        )
      ]));
    }
  }

  return {
    create,
    redrawBubble,
    redraw,
    destroy,
    clear,
    clearBubble,
    getSeries,
  };
}();

export default line;
