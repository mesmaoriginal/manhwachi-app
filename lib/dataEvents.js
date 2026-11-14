const {EventEmitter: EventEmitter} = require("events");

const dataEvents = new EventEmitter;

const DATA_UPDATED = "data-updated";

module.exports = {
  dataEvents: dataEvents,
  DATA_UPDATED: DATA_UPDATED
};