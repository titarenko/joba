# joba

Simple job (task) scheduler (manager).

## Installation

```bash
npm install joba --save
```

Depending on your choice you should also install bus and persistence dependencies (for example, joba-worque, joba-pg).

## Example

Task manager module.

```js
var Joba = require('joba');

var manager = new Joba({
	persistence: {
		name: 'pg',
		connection: {
			uri: 'postgresql://user:password@server/db',
			table: 'tasks'
		}
	},
	bus: {
		name: 'worque',
		connection: {
			host: 'server',
			login: 'user',
			password: 'password'
		}
	}
});

module.exports = manager;
```

Scheduler app.

```js
var manager = require('./manager');

manager.schedule('* */2 * * *', 'scan web');
```

Worker app.

```js
var manager = require('./manager');

manager.handle('scan web', scanWeb, true);

function scanWeb () {
	var profitPromise;
	// do something
	return profitPromise;
}
```

It's recommended to split your task handling process into 2 parts: scheduling and processing and run them into separate applications. It will allow you to restart worker app on failure without loosing the schedule or task being processed while failure has happened.

## API

### Joba(options)

Constructs manager instance. Accepts 2 options: bus and persistence configuration (see example).

### schedule(cronTime, name[, params])

Schedules task execution.

### start(name[, params])

Starts immediate task execution.

### handle(name, handler[, exitOnFailure])

Specifies task handler (must return promise). If `exitOnFailure` is `true`, then app will exit with code `75` (temporary failure), allowing you to implement restart-on-error management policy for worker app.

## License

BSD
