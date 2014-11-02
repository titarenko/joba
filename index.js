var CronJob = require('cron').CronJob;
var Q = require('q');
var debug = require('debug')('joba');

function Joba (options) {
	if (!options) {
		throw new Error('missing options');
	}

	if (!options.bus) {
		throw new Error('missing bus option')
	}

	if (!options.persistence) {
		throw new Error('missing persistence option');
	}

	this.bus = connect(options.bus);
	this.persistence = connect(options.persistence);
	
	this.tasks = {};
	this.pipes = {};
}

Joba.prototype.schedule = function schedule (cronTime, name, params) {
	var context = this;

	var job = new CronJob(cronTime, function cronJobTickHandler () {
		debug('trying to start', name);
		var task = context.tasks[name] || Q();
		context.tasks[name] = task.then(function whenPreviousTickHandled () {
			debug('starting', name);
			return context.bus.publish(name, params);
		});
	});

	return job.start();
};

Joba.prototype.start = function start (name, params) {
	return this.bus.publish(name, params);
};

Joba.prototype.pipe = function pipe (source, destination) {
	this.pipes[source] = destination;
};

Joba.prototype.handle = function handle (name, handler, exitOnFailure, logParams) {
	var context = this;
	return context.bus.subscribe(name, function internalTaskHandler (params, ack) {
		debug('running', name);
		var worklogItemPromise = context.persistence.createWorklogItem({
			name: name,
			started_at: new Date(),
			params: logParams ? params : null
		});
		try {
			var successHandler = buildTaskSuccessHandler(context, name, worklogItemPromise, ack);
			var errorHandler = buildTaskFailureHandler(context, name, worklogItemPromise, exitOnFailure, ack);
			handler(params).done(successHandler, errorHandler);
		} catch (error) {
			debug('prematurely failed running', name, error);
			updateWorklogItem.call(context, worklogItemPromise, error);
		}
	});
};

function buildTaskSuccessHandler (context, name, worklogItemPromise, ack) {
	return function taskSuccessHandler (taskResult) {
		debug('succeeding to run', name);
		updateWorklogItem.call(context, worklogItemPromise).then(function acknowledgeBus () {
			ack();
			debug('succeeded running', name);
		});
		var destination = context.pipes[name];
		if (destination) {
			debug('piping', name, 'to', destination);
			context.start(destination, taskResult);
		}
	};
}

function buildTaskFailureHandler (context, name, worklogItemPromise, exitOnFailure, ack) {
	return function taskFailureHandler (error) {
		debug('failing to run', name, error);
		updateWorklogItem.call(context, worklogItemPromise, error).then(function exitOrAcknowledgeBus () {
			if (exitOnFailure) {
				debug('failed running', name, error, 'shutting down');
				process.exit(75);
			} else {
				debug('failed running', name, error, 'but proceeding further');
				ack();
			}
		});
	};
}

function connect (provider) {
	return require('joba-' + provider.name)(provider.connection);
}

function updateWorklogItem (worklogItemPromise, error) {
	var context = this;
	return worklogItemPromise.then(function whenHaveWorklogItem (item) {
		var data = {
			finished_at: new Date(),
			error: error && error.stack || error
		};
		return context.persistence.updateWorklogItem(item, data);
	});
}

module.exports = Joba;
