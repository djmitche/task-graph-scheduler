#!/usr/bin/env node
var path        = require('path');
var Promise     = require('promise');
var debug       = require('debug')('scheduler:bin:handlers');
var base        = require('taskcluster-base');
var taskcluster = require('taskcluster-client');
var data        = require('../scheduler/data');
var exchanges   = require('../scheduler/exchanges');
var Handlers    = require('../scheduler/handlers');

/** Launch handlers */
var launch = function(profile) {
  // Load configuration
  var cfg = base.config({
    defaults:     require('../config/defaults'),
    profile:      require('../config/' + profile),
    envs: [
      'scheduler_publishMetaData',
      'taskcluster_queueBaseUrl',
      'taskcluster_authBaseUrl',
      'taskcluster_credentials_clientId',
      'taskcluster_credentials_accessToken',
      'pulse_username',
      'pulse_password',
      'aws_accessKeyId',
      'aws_secretAccessKey',
      'azure_accountName',
      'azure_accountKey',
      'influx_connectionString'
    ],
    filename:     'task-graph-scheduler'
  });

  // Create InfluxDB connection for submitting statistics
  var influx = new base.stats.Influx({
    connectionString:   cfg.get('influx:connectionString'),
    maxDelay:           cfg.get('influx:maxDelay'),
    maxPendingPoints:   cfg.get('influx:maxPendingPoints')
  });

  // Start monitoring the process
  base.stats.startProcessUsageReporting({
    drain:      influx,
    component:  cfg.get('scheduler:statsComponent'),
    process:    'handlers'
  });

  // Configure Task and TaskGraph entities
  var Task = data.Task.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azure')
  });
  var TaskGraph = data.TaskGraph.configure({
    schedulerId:      cfg.get('scheduler:schedulerId'),
    tableName:        cfg.get('scheduler:taskGraphTableName'),
    credentials:      cfg.get('azure')
  });

  // Setup AMQP exchanges and create a publisher
  // First create a validator and then publisher
  var validator = null;
  var publisher = null;
  var publisherCreated = base.validator({
    folder:           path.join(__dirname, '..', 'schemas'),
    constants:        require('../schemas/constants'),
    schemaPrefix:     'scheduler/v1/',
    preload: [
      'http://schemas.taskcluster.net/queue/v1/create-task-request.json'
    ]
  }).then(function(validator_) {
    validator = validator_;
    return exchanges.setup({
      credentials:        cfg.get('pulse'),
      exchangePrefix:     cfg.get('scheduler:exchangePrefix'),
      validator:          validator,
      referencePrefix:    'scheduler/v1/exchanges.json',
      drain:              influx,
      component:          cfg.get('scheduler:statsComponent'),
      process:            'handlers'
    });
  }).then(function(publisher_) {
    publisher = publisher_;
  });

  // Configure queue and queueEvents
  var queue = new taskcluster.Queue({
    baseUrl:        cfg.get('taskcluster:queueBaseUrl'),
    credentials:    cfg.get('taskcluster:credentials')
  });
  var queueEvents = new taskcluster.QueueEvents({
    exchangePrefix: cfg.get('taskcluster:queueExchangePrefix')
  });

  // When: publisher, schema and validator is created, proceed
  return publisherCreated.then(function() {
    // Create event handlers
    var handlers = new Handlers({
      Task:               Task,
      TaskGraph:          TaskGraph,
      publisher:          publisher,
      queue:              queue,
      queueEvents:        queueEvents,
      schedulerId:        cfg.get('scheduler:schedulerId'),
      credentials:        cfg.get('pulse'),
      queueName:          cfg.get('scheduler:listenerQueueName'),
      drain:              influx,
      component:          cfg.get('scheduler:statsComponent'),
    });

    // Start listening for events and handle them
    return handlers.setup();
  }).then(function() {
    debug('Handlers are now listening for events');

    // Notify parent process, so that this worker can run using LocalApp
    base.app.notifyLocalAppInParentProcess();
  });
};

// If handlers.js is executed start the handlers
if (!module.parent) {
  // Find configuration profile
  var profile = process.argv[2];
  if (!profile) {
    console.log("Usage: handlers.js [profile]")
    console.error("ERROR: No configuration profile is provided");
  }
  // Launch with given profile
  launch(profile).then(function() {
    debug("Launched handlers successfully");
  }).catch(function(err) {
    debug("Failed to start handlers, err: %s, as JSON: %j", err, err, err.stack);
    // If we didn't launch the handlers we should crash
    process.exit(1);
  });
}

// Export launch in-case anybody cares
module.exports = launch;