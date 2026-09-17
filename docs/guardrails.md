---
id: guardrails
title: Configuring Guardrails
sidebar_label: Configuring Guardrails
---

## Guardrails

This page contains information relating to the JavaScript [reference implementation](https://github.com/jsonata-js/jsonata) of JSONata, and not the JSONata expression language itself.

JSONata is a Turing-complete expression language, and as such, it is possible to write unbounded, or infinite loops.  This can be a potential problem if an application using JSONata is exposing the ability for client users to input expressions that are evaluated on the server.  A user could accidently or maliciously provide an expression that, if evaluated unchecked, could cause a denial of service situation.

This JSONata library provides a set of configurable 'guardrails' that limit the compute and memory resources that a single expression can consume. If this library is being used in a hosted environment to allow end users to provide their own expressions, then it would be prudent to set constraints.  The following sections describe each of the guardrails and how to configure them.  It does not provide recommended values or defaults.

### Stack overflow

In common with other functional languages, JSONata supports looping by writing [recursive functions](https://en.wikipedia.org/wiki/Functional_programming#Recursion).  The JSONata evaluator processes an expression using a set of mutually recursive functions (eval-apply cycle).  When a function is invoked (by itself or by another function), the call stack in the host JavaScript runtime will grow. If this stack grows too deep, evaluator could exhaust the memory of the host process causing it to crash.

The JSONata evaluator can be configured with a maximum stack[^stack] limit to prevent an expression from doing this by specifying the `stack` option. Error `D1011` will be thrown if the expression grows the stack beyond the specified limit.

```javascript
const jsonata = require('jsonata');

const data = {JSON: data};
const options = {
    stack: 500
};

(async () => {
    const expression = jsonata('<JSONata expression>', options);
    const result = await expression.evaluate(data);
})()
```


As an example, the [Ackermann function](https://en.wikipedia.org/wiki/Ackermann_function) could be implemented in JSONata using:

```
(
  $ack := function($m, $n) {
    $m = 0 ? $n + 1 :
    $n = 0 ? $ack($m - 1, 1) :
    $ack($m - 1, $ack($m, $n - 1))
  };

  $ack(3, 4)
)
```

Invoked as `$ack(3, 4)` would quickly evaluate to `125`. However, `$ack(4, 3)`, although theoretically computable, will readily hit the configured stack guardrail before causing any problems to the host server.

[^stack]: The term 'stack' is a slight misnomer here; it actually limits the number of times round the eval-apply cycle, which is related to the JavaScript stack depth. 

### Excessive execution time

It's possible (and desirable) to write [tail recursive](programming#tail-call-optimization-tail-recursion) functions that don't grow the stack at all.  For these types of functions, a [stack guardrail](#stack-overflow) would not be sufficient to protect against unbounded loops.

The JSONata evaluator can be configured with a maximum time limit to protect against runaway expressions by specifying the `timeout` option.  Error `D1012` will be thrown if the expression runs for longer than the specified timeout (in milliseconds).

It's good practice to specify both `stack` and `timeout`.

```javascript
const jsonata = require('jsonata');

const data = {JSON: data};
const options = {
    stack: 500,
    timeout: 1000  // in milliseconds
};

(async () => {
    const expression = jsonata('<JSONata expression>', options);
    const result = await expression.evaluate(data);
})()
```

As an example, an infinite loop could be written in JSONata:

```
( 
    $inf := function() {
        $inf()
    }; 
    
    $inf()
)
```

This is tail recursive, and would run forever without the timeout guardrail.

### Deterministic evaluation budget

The `timeout` and `stack` guardrails are configured when the expression is compiled and depend (for `timeout`) on the wall-clock speed of the host machine.  If the same expression and data need to behave identically on every machine and on every invocation - e.g. when running untrusted customer expressions on a shared, multi-tenant server - a per-evaluation, deterministic *budget* can be passed to `evaluate()` as its third argument instead.

The budget has two independent limits:

- `steps`: the maximum number of evaluation steps.  Every expression node evaluation counts as one step, as does each iteration of the built-in higher-order functions (`$map`, `$filter`, `$single`, `$reduce`, `$each`, `$sift`, `$sort`/order-by), and the functions that build strings or sequences (`$pad`, `$join`, `$replace`, `$split`, `$match` and the range operator) charge for the characters/entries they are about to allocate *before* allocating them.  Error `D1014` is thrown as soon as the limit is exceeded - including partway through a loop.
- `depth`: the maximum recursion depth of the eval-apply cycle.  A self-calling function with no terminating condition trips this error (`D1015`) before the JavaScript call stack can overflow.  Tail calls are optimized onto a trampoline and do not grow the depth; they are bounded by `steps` instead.

The thrown error has a `budgetExceeded` property set to `'steps'` or `'depth'` (so it can be distinguished from ordinary expression errors), plus `consumed` (the number of steps used at the abort point), `value` (the configured limit) and `position` (the offset in the source expression of the node being evaluated when it aborted).

After the evaluation finishes, the same object carries the actual resource usage in its `stepsUsed` and `depthPeak` properties.  These numbers depend only on the expression and the input data, so the same expression and input always produce the same values - they can be used for capacity planning and regression comparisons.  When no budget is supplied, evaluation behaves exactly as before.

```javascript
const jsonata = require('jsonata');

(async () => {
    const expression = jsonata('<JSONata expression>');
    const budget = {
        steps: 100000,  // abort after 100,000 evaluation steps
        depth: 200      // abort if recursion goes 200 frames deep
    };
    try {
        const result = await expression.evaluate(data, undefined, budget);
    } catch (err) {
        // err.code is 'D1014' (steps) or 'D1015' (depth)
        // err.budgetExceeded is 'steps' or 'depth'
        // err.consumed is the number of steps used at the abort
        // err.position is the offset of the current expression node
    }
    // budget.stepsUsed and budget.depthPeak are populated on completion
})()
```

The `steps` and `depth` limits, if supplied, must be non-negative integers; any other value causes `evaluate()` to reject with a `TypeError`.  A node-style callback can still be passed as the third argument, or supplied as the `callback` property of the budget object.

### Excessive sequence length

It's possible to write expressions that result in excessively long result sequences.  This could ultimately lead to memory exhaustion in the host server. The `sequence` option can be set to specify the maximum sequence length that can be created by an expression, including any intermediate sequences created by sub-expressions.  Error `D2015` will be thrown if, during the evaluation of an expression, the evaluator attempts to generate a sequence exceeding this upper limit.


```javascript
const jsonata = require('jsonata');

const data = {JSON: data};
const options = {
    sequence: 1e6  // maximum of one million items in a sequence
};

(async () => {
    const expression = jsonata('<JSONata expression>', options);
    const result = await expression.evaluate(data);
})()
```

As an example, the following JSONata expression attempts to generate a sequence of 100 million numbers. The guardrail configured above would prevent this.

```
[1..10000].([1..10000])
```

### Rogue regular expressions

A number of functions use [regular expressions](regex) to process strings.  Alongside the power and flexibility that regexes provide, there are situations whereby badly crafted or malicious expressions could cause the processing engine take an [excessive amount of time](https://en.wikipedia.org/wiki/ReDoS) (exponential to the input string length).  Since the regex processing is not implemented in the core JSONata (eval-apply) evaluator, the `timeout` guardrail cannot protect against this.

It is possible to specify which regex processor is invoked by the JSONata evaluator. This is configured using the `RegexEngine` option. When this is not set, the evaluator will use the default JavaScript [RegExp](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp) class.

The [packaged version of JSONata](https://www.npmjs.com/package/jsonata) has no runtime dependencies on other packages, but it is possible to use the `RegexEngine` option to invoke a third-party ReDoS library whenever a regular expression is encountered in a JSONata expression.

The following code shows how this is done using the [redos-detector](https://github.com/tjenkinson/redos-detector) module:

```javascript
const jsonata = require('jsonata');
const redos = require('redos-detector');

// Simple wrapper that invokes redos-detector before delegating
// to built-in RegExp class
const SafeRegExp = function(regex) {
    if (!redos.isSafe(regex).safe) {
        throw {
            code: 'U1001',
            stack: (new Error()).stack,
            value: regex,
            message: 'Rejecting regex (potential ReDoS): ' + regex
        };
    }
    this.regex = regex;
    };

SafeRegExp.prototype.exec = function(str) {
    return this.regex.exec(str);
}

const data = {JSON: data};
const options = {
    RegexEngine: SafeRegExp
};

(async () => {
    const expression = jsonata('<JSONata expression>', options);
    const result = await expression.evaluate(data);
})()
```

Other similar libraries are available. This is not an endorsement of any particular one. The developer should choose one according to their requirements.
