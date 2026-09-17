/**
 * © Copyright IBM Corp. 2026 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 *
 * Tests for the deterministic evaluation budget: the optional step count and
 * recursion depth limits that can be passed to evaluate().
 */

"use strict";

var jsonata = require("../src/jsonata");
var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
var expect = chai.expect;

describe("Evaluation budget", function () {
    describe("budget statistics", function () {
        it("reports the consumed steps and peak depth after a successful evaluation", async function () {
            var budget = {};
            var result = await jsonata("1 + 2").evaluate({}, undefined, budget);
            expect(result).to.equal(3);
            expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
            expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
        });

        it("produces identical statistics for the same expression and input", async function () {
            var expression = "($x := [1..20]; $sum($x.($ % 2 = 0 ? $ * 2 : $)))";
            var input = {};
            var first = {};
            var second = {};
            await jsonata(expression).evaluate(input, undefined, first);
            await jsonata(expression).evaluate(input, undefined, second);
            expect(first).to.deep.equal(second);
            expect(second.stepsUsed).to.equal(first.stepsUsed);
            expect(second.depthPeak).to.equal(first.depthPeak);
        });

        it("reports the statistics even when the evaluation fails for another reason", async function () {
            var budget = {};
            await expect(jsonata("1 + \"a\"").evaluate({}, undefined, budget)).to.be.rejected;
            expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
            expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
        });

        it("reports zero statistics when the expression was compiled with syntax errors", async function () {
            var budget = {};
            var expression = jsonata("1 +", { recover: true });
            await expect(expression.evaluate({}, undefined, budget)).to.be.rejected
                .and.eventually.deep.contain({ code: "S0500" });
            expect(budget.stepsUsed).to.equal(0);
            expect(budget.depthPeak).to.equal(0);
        });
    });

    describe("unbudgeted evaluations", function () {
        it("evaluates without runtime options exactly as before", async function () {
            var result = await jsonata("(1 + 2) * 3").evaluate({});
            expect(result).to.equal(9);
        });

        it("evaluates with an empty options object exactly as before", async function () {
            var result = await jsonata("[1..5]").evaluate({}, undefined, {});
            expect(result).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("evaluates with an explicit null third argument exactly as before", async function () {
            var result = await jsonata("[1..5]").evaluate({}, undefined, null);
            expect(result).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("ignores a non-object third argument", async function () {
            var result = await jsonata("[1..5]").evaluate({}, undefined, "ignored");
            expect(result).to.deep.equal([1, 2, 3, 4, 5]);
        });

        it("still supports the node-style callback as the third argument", function (done) {
            var expression = jsonata("1 + 2");
            expression.evaluate({}, undefined, function (error, response) {
                expect(error).to.equal(null);
                expect(response).to.equal(3);
                done();
            });
        });

        it("supports a callback supplied on the options object", function (done) {
            var expression = jsonata("1 + 2");
            expression.evaluate({}, undefined, {
                callback: function (error, response) {
                    expect(error).to.equal(null);
                    expect(response).to.equal(3);
                    done();
                }
            });
        });
    });

    describe("step budget", function () {
        it("allows an evaluation that consumes exactly the number of steps allowed", async function () {
            var result = await jsonata("1").evaluate({}, undefined, { steps: 1 });
            expect(result).to.equal(1);
        });

        it("aborts when the step count exceeds the limit", async function () {
            var budget = { steps: 1 };
            var error;
            try {
                await jsonata("1 + 2").evaluate({}, undefined, budget);
            } catch (err) {
                error = err;
            }
            expect(error).to.exist;
            expect(error.code).to.equal("D1014");
            expect(error.budgetExceeded).to.equal("steps");
            expect(error.value).to.equal(1);
            expect(error.consumed).to.be.above(1);
            expect(error.position).to.be.a("number");
            expect(error.message).to.equal(
                "The evaluation step budget of 1 steps was exceeded after " +
                error.consumed + " steps"
            );
            expect(budget.stepsUsed).to.equal(error.consumed);
        });

        it("reports a zero step limit as allowing zero steps", async function () {
            await expect(jsonata("1").evaluate({}, undefined, { steps: 0 }))
                .to.be.rejectedWith(undefined)
                .and.eventually.deep.contain({ code: "D1014", budgetExceeded: "steps", value: 0, consumed: 1 });
        });

        it("stops a three level map partway through the array rather than after it", async function () {
            var input = Array.from({ length: 10000 }, function (_, index) { return index; });
            var expression = jsonata(
                "$map($, function($x){$map([$x], function($y){$map([$y], function($z){$z + 1})})})"
            );
            var start = Date.now();
            var error = await expect(expression.evaluate(input, undefined, { steps: 5000 }))
                .to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
            expect(error.consumed).to.be.at.most(5001);
            // the abort must be prompt; the unbudgeted expression takes many times longer
            expect(Date.now() - start).to.be.below(1000);
        });

        it("stops $filter partway through its loop", async function () {
            var error = await expect(
                jsonata("$filter([1..100], function($x){ $x % 2 = 0 })")
                    .evaluate({}, undefined, { steps: 20 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
            expect(error.position).to.equal(12);
        });

        it("stops $reduce partway through its loop", async function () {
            var error = await expect(
                jsonata("$reduce([1..100], function($a, $b){ $a + $b }, 0)")
                    .evaluate({}, undefined, { steps: 20 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops $single partway through its loop", async function () {
            var error = await expect(
                jsonata("$single([1..100], function($x){ $x = 50 })")
                    .evaluate({}, undefined, { steps: 20 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops $each partway through its loop", async function () {
            var input = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
            var error = await expect(
                jsonata("$each($, function($v){ $v * 2 })")
                    .evaluate(input, undefined, { steps: 8 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops $sift partway through its loop", async function () {
            var input = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
            var error = await expect(
                jsonata("$sift($, function($v){ $v > 0 })")
                    .evaluate(input, undefined, { steps: 8 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops an order-by sort partway through its comparator calls", async function () {
            var error = await expect(
                jsonata("[1..100]^(< $)")
                    .evaluate({}, undefined, { steps: 20 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops a map whose callback is a registered JavaScript function", async function () {
            // the callback contains no expression nodes, so the loop iteration charge
            // is the only thing available to abort the evaluation mid-array
            var input = Array.from({ length: 10000 }, function (_, index) { return index; });
            var expression = jsonata("$map($, $double)");
            expression.registerFunction("double", function (value) { return value * 2; });
            var start = Date.now();
            var error = await expect(
                expression.evaluate(input, undefined, { steps: 100 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
            expect(error.consumed).to.be.at.most(101);
            expect(Date.now() - start).to.be.below(1000);
        });
    });

    describe("recursion depth budget", function () {
        var nonTailRecursive = "($f := function($n){ $n = 0 ? 0 : $f($n - 1) + 1 }; $f(20))";

        it("allows recursion within the depth limit", async function () {
            var result = await jsonata(nonTailRecursive)
                .evaluate({}, undefined, { depth: 100, steps: 10000 });
            expect(result).to.equal(20);
        });

        it("stops non-tail recursive functions using the depth counter", async function () {
            var infinite = "($f := function($n){ $f($n) + 1 }; $f(1))";
            var start = Date.now();
            var error = await expect(
                jsonata(infinite).evaluate({}, undefined, { depth: 100 })
            ).to.be.rejected;
            expect(error).to.deep.contain({
                code: "D1015",
                budgetExceeded: "depth",
                value: 100
            });
            expect(error.consumed).to.be.a("number").and.to.be.above(0);
            expect(error.position).to.be.a("number");
            // the native JavaScript stack must not get a chance to overflow
            expect(Date.now() - start).to.be.below(1000);
        });

        it("does not grow the depth on tail calls", async function () {
            var tailRecursive = "($f := function($n){ $n <= 0 ? 0 : $f($n - 1) }; $f(100000000))";
            var error = await expect(
                jsonata(tailRecursive).evaluate({}, undefined, { steps: 1000, depth: 100 })
            ).to.be.rejected;
            // the trampoline keeps the depth flat, so the step budget is what stops it
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("stops tail recursive functions using the step counter", async function () {
            var tailRecursive = "($f := function(){ $f() }; $f())";
            var start = Date.now();
            var error = await expect(
                jsonata(tailRecursive).evaluate({}, undefined, { steps: 10000 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
            expect(Date.now() - start).to.be.below(1000);
        });
    });

    describe("string allocations", function () {
        it("charges the padded characters before $pad allocates them", async function () {
            var error = await expect(
                jsonata('$pad("", 100000)').evaluate({}, undefined, { steps: 50 })
            ).to.be.rejected;
            expect(error).to.deep.contain({
                code: "D1014",
                budgetExceeded: "steps",
                position: 5
            });
            expect(error.consumed).to.be.at.least(100000);
        });

        it("charges the joined characters before $join allocates them", async function () {
            var error = await expect(
                jsonata('["a", "b", "c"].$join(",")').evaluate({}, undefined, { steps: 5 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
            expect(error.consumed).to.be.at.least(5);
        });

        it("charges the result of $join with no separator", async function () {
            var result = await jsonata('$join(["foo", "bar"])').evaluate({}, undefined, { steps: 20 });
            expect(result).to.equal("foobar");
        });

        it("charges the substituted characters before $replace builds the string", async function () {
            var error = await expect(
                jsonata('$replace("xxxxxxxxxx", "x", "yyyyyyyyyyy")')
                    .evaluate({}, undefined, { steps: 30 })
            ).to.be.rejected;
            expect(error).to.deep.contain({
                code: "D1014",
                budgetExceeded: "steps",
                position: 9
            });
        });

        it("charges each iteration of a regex $replace", async function () {
            var error = await expect(
                jsonata('$replace("aaaaaaaaaa", /a/, "bb")')
                    .evaluate({}, undefined, { steps: 10 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("charges each iteration of $split with a regex separator", async function () {
            var error = await expect(
                jsonata('$split("a,b,c,d,e", /,/)').evaluate({}, undefined, { steps: 5 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("charges each iteration of $match", async function () {
            var error = await expect(
                jsonata('$match("ab ab ab ab", /ab/)').evaluate({}, undefined, { steps: 5 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("charges the entries allocated by the range operator", async function () {
            var error = await expect(
                jsonata("[1..100]").evaluate({}, undefined, { steps: 50 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps", position: 4 });
        });
    });

    describe("budget option validation", function () {
        it("rejects a negative step limit", function () {
            return expect(jsonata("1").evaluate({}, undefined, { steps: -1 }))
                .to.be.rejectedWith(TypeError, /steps/);
        });

        it("rejects a non-integer depth limit", function () {
            return expect(jsonata("1").evaluate({}, undefined, { depth: 1.5 }))
                .to.be.rejectedWith(TypeError, /depth/);
        });

        it("rejects a non-numeric step limit", function () {
            return expect(jsonata("1").evaluate({}, undefined, { steps: "10" }))
                .to.be.rejectedWith(TypeError, /steps/);
        });

        it("rejects a null depth limit", function () {
            return expect(jsonata("1").evaluate({}, undefined, { depth: null }))
                .to.be.rejectedWith(TypeError, /depth/);
        });

        it("rejects a boolean step limit", function () {
            return expect(jsonata("1").evaluate({}, undefined, { steps: true }))
                .to.be.rejectedWith(TypeError, /steps/);
        });

        it("accepts zero as an explicit limit", async function () {
            var result = await jsonata("1").evaluate({}, undefined, { steps: 1, depth: 1 });
            expect(result).to.equal(1);
        });
    });

    describe("budget isolation", function () {
        it("propagates the budget error out of $eval rather than wrapping it", async function () {
            var error = await expect(
                jsonata('$eval("[1..100]")').evaluate({}, undefined, { steps: 30 })
            ).to.be.rejected;
            expect(error).to.deep.contain({ code: "D1014", budgetExceeded: "steps" });
        });

        it("maintains independent statistics for concurrent evaluations", async function () {
            var expression = jsonata("$sum([1..10])");
            var small = {};
            var large = {};
            var [smallResult, largeResult] = await Promise.all([
                expression.evaluate({}, undefined, small),
                expression.evaluate({}, undefined, large)
            ]);
            expect(smallResult).to.equal(largeResult);
            expect(small.stepsUsed).to.equal(large.stepsUsed);
            var bounded = await expression.evaluate({}, undefined, { steps: 30 });
            expect(bounded).to.equal(55);
            await expect(expression.evaluate({}, undefined, { steps: 5 })).to.be.rejected
                .and.eventually.deep.contain({ code: "D1014" });
        });

        it("still applies the legacy stack and timeout guardrails", async function () {
            var expression = jsonata("($f := function(){ $f() }; $f())", {
                timeout: 1000,
                stack: 100
            });
            // this tail-recursive function is bounded by the timeout guardrail
            await expect(expression.evaluate()).to.be.rejected
                .and.eventually.deep.contain({ code: "D1012" });
        });

        it("applies budget limits alongside legacy guardrails", async function () {
            var expression = jsonata("($f := function($n){ $f($n) + 1 }; $f(1))", {
                stack: 100000
            });
            var error = await expect(expression.evaluate({}, undefined, { depth: 50 }))
                .to.be.rejected;
            // the (much lower) depth budget is the limit that trips first
            expect(error).to.deep.contain({ code: "D1015", budgetExceeded: "depth", value: 50 });
        });
    });
});
