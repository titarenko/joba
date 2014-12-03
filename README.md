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

### handle(name, handler[, exitOnFailure][, logParams])

Deprecated (use overload with options as last param).

Specifies task handler. If `exitOnFailure` is `true`, then app will exit with code `75` (temporary failure), allowing you to implement restart-on-error management policy for worker app. If `logParams` is `true` then params will be saved in the corresponding work log record, if `logParams` is omitted, then logging will happen only on error, otherwise (if `logParams === false`) no logging will happen at all.

### handle(name, handler[, options])

Specifies task handler.

Options:

name | purpose
--- | ---
exitOnFailure | if `true`, then app will exit with code `75` (temporary failure), allowing you to implement restart-on-error management policy for worker app
logParams | if `true` then params will be saved in the corresponding work log record, if omitted, then logging will happen only on error, otherwise (if `false`) no logging will happen at all
concurrency | maximal number of tasks handled simultaneously

### pipe(source, destination)

Passes output of one task to input(s) of another task(s). 

If `destination` is string:

```
source -> destination
```

otherwise, if `destination` is object and `destination.opcode` is `map`:

```
source[0] -> destination.names[0]
source[1] -> destination.names[0]
source[2] -> destination.names[0]
...
```

and if `destination.opcode` is `spread`:

```
source[0] -> destination.names[0]
source[1] -> destination.names[1]
source[2] -> destination.names[2]
...
```

## License

BSD
