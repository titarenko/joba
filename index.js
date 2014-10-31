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

Joba.prototype.handle = function handle (name, handler, exitOnFailure) {
	var context = this;
	return context.bus.subscribe(name, function internalTaskHandler (params, ack) {
		debug('running', name);
		var worklogItemPromise = context.persistence.createWorklogItem({
			name: name,
			started_at: new Date(),
			params: params
		});
		try {
			handler(params).done(function taskSuccessHandler () {
				debug('succeeded running', name);
				updateWorklogItem.call(context, worklogItemPromise).then(function acknowledgeBus () {
					ack();
				});
			}, function taskFailureHandler (error) {
				debug('failed running', name, error);
				updateWorklogItem.call(context, worklogItemPromise, error).then(function exitOrAcknowledgeBus () {
					if (exitOnFailure) {
						process.exit(75);
					} else {
						ack();
					}
				});
			});
		} catch (error) {
			debug('prematurely failed running', name, error);
			updateWorklogItem.call(context, worklogItemPromise, error);
		}
	});
};

function connect (provider) {
	return require('joba-' + provider.name)(provider.connection);
}

function updateWorklogItem (worklogItemPromise, error) {
	var context = this;
	return worklogItemPromise.then(function whenHaveWorklogItem (item) {
		return context.persistence.updateWorklogItem(item, {
			finished_at: new Date(),
			error: error && error.stack || error
		});
	});
}

module.exports = Joba;
