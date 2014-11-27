var _ = require('lodash');

function Pipe (joba, source, destination) {
	this.joba = joba;
	this.source = source;
	this.destinations = [];
	if (destination) {
		this.add(destination);
	}
}

module.exports = Pipe;

Pipe.prototype.add = function addDestination (destination) {
	if (typeof destination === 'string') {
		this.destinations.push({
			type: 'direct',
			name: destination
		});
	} else if (destination.opcode === 'map') {
		this.destinations.push({
			type: 'map',
			name: destination.names[0]
		});
	} else if (destination.opcode === 'spread') {
		this.destinations.push({
			type: 'spread',
			names: destination.names
		});
	} else {
		debug('unknown destination structure', destination);
	}
};

Pipe.prototype.run = function (taskResult) {
	var context = this;
	context.destinations.forEach(function runDestination (destination) {
		context.handleDestination(destination, taskResult);
	});
};

Pipe.prototype.handleDestination = function (destination, taskResult) {
	switch (destination.type) {
		case 'direct':
			this.handleDirectDestination(destination, taskResult);
			break;
		case 'map':
			this.handleMapDestination(destination, taskResult);
			break;
		case 'spread':
			this.handleSpreadDestination(destination, taskResult);
			break;
		default:
			debug('unknown pipe destination type', destination.type);
	}
};

Pipe.prototype.handleDirectDestination = function (destination, taskResult) {
	debug('direct piping', this.source, 'to', destination.name);
	return this.joba.start(destination.name, taskResult);
};

Pipe.prototype.handleMapDestination = function (destination, taskResult) {
	var context = this;
	debug('map piping', this.source, 'to', destination.name);
	return taskResult.map(function resultItemMapper (item) {
		return context.joba.start(destination.name, item);
	});
};

Pipe.prototype.handleSpreadDestination = function (destination, taskResult) {
	var context = this;
	debug('spread piping', this.source, 'to', destination.names);
	return taskResult.map(function resultItemMapper (item, index) {
		return context.joba.start(destination.names[index], item);
	});
};
