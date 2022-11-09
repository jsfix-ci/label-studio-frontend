import * as d3 from "d3";
import Utils from "../../../utils";
import { defaultStyle } from "../../../core/Constants";

export const line = (x, y) =>
  d3
    .line()
    .x(d => x(d[0]))
    .y(d => y(d[1]));

export const idFromValue = value => value.substr(1);

export const getOptimalWidth = () => ((window.screen && window.screen.width) || 1440) * (window.devicePixelRatio || 2);

export const sparseValues = (values, max = 1e6) => {
  if (values.length <= max) return values;
  let next = 0;
  const step = (values.length - 1) / (max - 1);
  // return values.filter((_, i) => i > next && (next += step))

  return values.filter((_, i) => {
    if (i < next) return false;
    next += step;
    return true;
  });
};

export const getRegionColor = (region, alpha = 1) => {
  const color = (region.style || defaultStyle).fillcolor;

  return Utils.Colors.convertToRGBA(color, alpha);
};

// fixes `observe` - it watches only the changes of primitive props of observables count
// so pass all the required primitives to this stub and they'll be observed
export const fixMobxObserve = () => {};

// clear d3 sourceEvent via async call to prevent infinite loops
export const clearD3Event = f => setTimeout(f, 0);

// check if we are in recursive event loop, caused by `event`
export const checkD3EventLoop = event => {
  if (!/* TODO: JSFIX could not patch the breaking change:
  Remove d3.event and changed the interface for the listeners parsed to .on() methods 
  Suggested fix: If this reading of the d3.event property is inside an event listener, you can change `d3.event` to just be `event` and then parse the event object as the new first argument to the event listener. See the example: https://observablehq.com/@d3/d3v6-migration-guide#cell-427. 
  If you are reading d3.event outside of an event listener, there is no “good/clean” alternative.
  Our suggestion is to have your own variable containing the last event, which is then set inside the different event listener, from which you are trying to get the event using d3.event.
  So an event listener on a drag object could look something like:
      drag().on("start", (event, d) => lastEvent = event; … ) */
  d3.event.sourceEvent) return true;
  if (event) return (
    /* TODO: JSFIX could not patch the breaking change:
    Remove d3.event and changed the interface for the listeners parsed to .on() methods 
    Suggested fix: If this reading of the d3.event property is inside an event listener, you can change `d3.event` to just be `event` and then parse the event object as the new first argument to the event listener. See the example: https://observablehq.com/@d3/d3v6-migration-guide#cell-427. 
    If you are reading d3.event outside of an event listener, there is no “good/clean” alternative.
    Our suggestion is to have your own variable containing the last event, which is then set inside the different event listener, from which you are trying to get the event using d3.event.
    So an event listener on a drag object could look something like:
        drag().on("start", (event, d) => lastEvent = event; … ) */
    d3.event.sourceEvent.type === event
  );
  return ["start", "brush", "end"].includes(/* TODO: JSFIX could not patch the breaking change:
  Remove d3.event and changed the interface for the listeners parsed to .on() methods 
  Suggested fix: If this reading of the d3.event property is inside an event listener, you can change `d3.event` to just be `event` and then parse the event object as the new first argument to the event listener. See the example: https://observablehq.com/@d3/d3v6-migration-guide#cell-427. 
  If you are reading d3.event outside of an event listener, there is no “good/clean” alternative.
  Our suggestion is to have your own variable containing the last event, which is then set inside the different event listener, from which you are trying to get the event using d3.event.
  So an event listener on a drag object could look something like:
      drag().on("start", (event, d) => lastEvent = event; … ) */
  d3.event.sourceEvent.type);
};

const formatDateDiff = (start, end) => {
  const dates = [start.toLocaleDateString(), end.toLocaleDateString()];

  if (dates[1] !== dates[0]) return dates;
  return [start.toLocaleTimeString(), end.toLocaleTimeString()];
};

export const formatRegion = node => {
  let ranges = [];

  if (node.parent.format === "date") {
    ranges = formatDateDiff(new Date(node.start), new Date(node.end));
  } else {
    ranges = [node.start, node.end];
  }
  return node.instant ? ranges[0] : ranges.join("–");
};

export const formatTrackerTime = time => new Date(time).toUTCString();