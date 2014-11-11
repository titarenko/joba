var CronJob = require('cron').CronJob;
var Promise = require('bluebird');
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

	this.bus = isBusInstance(options.bus) ? options.bus : connect(options.bus);
	this.persistence = isPersistenceInstance(options.persistence) ? options.persistence : connect(options.persistence);
	
	this.tasks = {};

	this.directPipes = {};
	this.mapPipes = {};
	this.spreadPipes = {};
}

Joba.prototype.schedule = function schedule (cronTime, name, params) {
	var context = this;

	var job = new CronJob(cronTime, function cronJobTickHandler () {
		debug('trying to start', name);
		var task = context.tasks[name] || Promise.resolve();
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
	if (typeof destination === 'object') {
		switch (destination.opcode) {
			case 'map':
				this.mapPipes[source] = destination.names[0];
				break;
			case 'spread':
				this.spreadPipes[source] = destination.names;
				break;
		}
	} else if (typeof destination === 'string') {
		this.directPipes[source] = destination;
	}
};

Joba.prototype.handle = function handle (name, handler, exitOnFailure, logParams) {
	var context = this;
	return context.bus.subscribe(name, function internalTaskHandler (params, ack) {
		debug('running', name);
		var worklogItemPromise = context.persistence.createWorklogItem({
			name: name,
			started_at: new Date(),
			params: logParams === true ? params : null
		});
		try {
			var successHandler = buildTaskSuccessHandler(context, name, worklogItemPromise, ack);
			var errorHandler = buildTaskFailureHandler(context, name, params, logParams, worklogItemPromise, exitOnFailure, ack);
			handler(params).done(successHandler, errorHandler);
		} catch (error) {
			error = error && (error.stack || error.toString());
			debug('prematurely failed running', name, error);
			updateWorklogItem.call(context, worklogItemPromise, error);
		}
	});
};

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
	var destination = context.directPipes[name];
	if (destination) {
		debug('direct piping', name, 'to', destination);
		return context.start(destination, taskResult);
	}

	var destination = context.mapPipes[name];
	if (destination) {
		debug('map piping', name, 'to', destination);
		return taskResult.map(function resultItemMapper (item) {
			return context.start(destination, item);
		});
	}

	var destination = context.spreadPipes[name];
	if (destination) {
		debug('spread piping', name, 'to', destination);
		return taskResult.map(function resultItemMapper (item, index) {
			return context.start(destination[index], item);
		});	
	}
}

module.exports = Joba;

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
