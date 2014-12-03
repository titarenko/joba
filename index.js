var CronJob = require('cron').CronJob;
var Promise = require('bluebird');
var debug = require('debug')('joba');
var Pipe = require('./pipe');

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

	this.bus = isBusInstance(options.bus) ? options.bus : connect(options.bus);
	this.persistence = isPersistenceInstance(options.persistence) ? options.persistence : connect(options.persistence);
	
	this.tasks = {};
	this.pipes = {};
}

Joba.prototype.schedule = function schedule (cronTime, name, params) {
	var context = this;

	var job = new CronJob(cronTime, function cronJobTickHandler () {
		debug('trying to start', name);
		var task = context.tasks[name] || Promise.resolve();
		context.tasks[name] = task.then(function whenPreviousTickHandled () {
			debug('starting', name);
			return context.start(name, params);
		});
	});

	return job.start();
};

Joba.prototype.start = function start (name, params) {
	return this.bus.publish(name, params);
};

Joba.prototype.pipe = function pipe (source, destination) {
	var pipe = this.pipes[source] = this.pipes[source] || new Pipe(this, source);
	pipe.add(destination);
};

Joba.prototype.handle = function handle (name, handler, exitOnFailure, logParams) {
	var options = {
		exitOnFailure: false,
		logParams: undefined,
		concurrency: 1
	};

	if (typeof exitOnFailure === 'object') {
		for (var key in exitOnFailure) {
			options[key] = exitOnFailure[key];
		}
	} else {
		options.exitOnFailure = exitOnFailure;
		options.logParams = logParams;
	}

	var context = this;
	return context.bus.subscribe(name, options.concurrency, function internalTaskHandler (params, ack) {
		debug('running', name);
		var worklogItemPromise = context.persistence.createWorklogItem({
			name: name,
			started_at: new Date(),
			params: options.logParams === true ? params : null
		});
		try {
			var successHandler = buildTaskSuccessHandler(context, name, worklogItemPromise, ack);
			var errorHandler = buildTaskFailureHandler(context, name, params, options.logParams, worklogItemPromise, options.exitOnFailure, ack);
			Promise.resolve(handler(params)).done(successHandler, errorHandler);
		} catch (error) {
			error = error && (error.stack || error.toString());
			debug('prematurely failed running', name, error);
			updateWorklogItem.call(context, worklogItemPromise, error);
		}
	});
};

module.exports = Joba;

function buildTaskSuccessHandler (context, name, worklogItemPromise, ack) {
	return function taskSuccessHandler (taskResult) {
		ack();
		debug('succeeded running', name);
		updateWorklogItem.call(context, worklogItemPromise);
		handlePiping(context, name, taskResult);
	};
}

function buildTaskFailureHandler (context, name, params, logParams, worklogItemPromise, exitOnFailure, ack) {
	return function taskFailureHandler (error) {
		error = error && (error.stack || error.toString());
		params = logParams !== false ? params : undefined;
		updateWorklogItem.call(context, worklogItemPromise, error, params).finally(function afterLogUpdated () {
			if (exitOnFailure) {
				debug('failed running', name, error, 'shutting down');
				ack();
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

function updateWorklogItem (worklogItemPromise, error, params) {
	var context = this;
	return worklogItemPromise.then(function whenHaveWorklogItem (item) {
		var data = {
			finished_at: new Date(),
			error: error && error.stack || error
		};
		if (params !== undefined) {
			data.params = params;
		}
		return context.persistence.updateWorklogItem(item, data);
	});
}

function handlePiping (context, name, taskResult) {
	var destination = context.pipes[name];
	if (destination) {
		return destination.run(taskResult);
	}
}

function isFunctionWithArity (instance, arity) {
	return typeof instance === 'function' && instance.length === arity;
}

function isBusInstance (instance) {
	return isFunctionWithArity(instance.publish, 2) &&
		isFunctionWithArity(instance.subscribe, 2);
}

function isPersistenceInstance (instance) {
	return isFunctionWithArity(instance.createWorklogItem, 1) &&
		isFunctionWithArity(instance.updateWorklogItem, 2);
}
