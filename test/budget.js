/**
 * © Copyright IBM Corp. 2026 All Rights Reserved
 *   Project name: JSONata
 *   This project is licensed under the MIT License, see LICENSE
 *
 * Tests for the deterministic evaluation budget: step and recursion depth
 * limits, the budget-exceeded error shape, and the consumed budget report.
 */

"use strict";

var jsonata = require("../src/jsonata");
var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
var expect = chai.expect;

describe("Evaluation budget", () => {
    describe("budget reporting", () => {
        it("reports the consumed steps and peak depth after a successful evaluation", async () => {
            var budget = {};
            var result = await jsonata("1 + 2").evaluate({}, undefined, undefined, budget);
            expect(result).to.equal(3);
            expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
            expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
        });

        it("reports the consumed steps even when the expression throws", async () => {
            var budget = {};
            await expect(jsonata("$undefinedFunction()").evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected;
            expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
            expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
        });

        it("reports identical numbers for the same expression and input on every run", async () => {
            var input = {
                library: {
                    books: [
                        {title: "a", price: 1},
                        {title: "b", price: 2}
                    ]
                }
            };
            var measure = async () => {
                var budget = {};
                await jsonata("library.books{title: price}").evaluate(input, undefined, undefined, budget);
                return [budget.stepsUsed, budget.depthPeak];
            };
            var first = await measure();
            for (var i = 0; i < 5; i++) {
                expect(await measure()).to.deep.equal(first);
            }
        });

        it("keeps separate counters for concurrent evaluations of the same expression", async () => {
            var expression = "$map(data, function($v) { $v * 2 })";
            var compiled = jsonata(expression);
            var smallBudget = {};
            var largeBudget = {};
            var [small, large] = await Promise.all([
                compiled.evaluate({data: [1, 2, 3]}, undefined, undefined, smallBudget),
                compiled.evaluate({data: [1, 2, 3, 4, 5, 6]}, undefined, undefined, largeBudget)
            ]);
            expect(small).to.deep.equal([2, 4, 6]);
            expect(large).to.deep.equal([2, 4, 6, 8, 10, 12]);
            expect(largeBudget.stepsUsed).to.be.above(smallBudget.stepsUsed);
        });

        it("populates the budget before invoking the callback", (done) => {
            var budget = {};
            jsonata("1 + 2").evaluate({}, undefined, function(err, result) {
                expect(err).to.equal(null);
                expect(result).to.equal(3);
                expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
                expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
                done();
            }, budget);
        });
    });

    describe("step budget", () => {
        it("returns the result when the number of steps is within the limit", async () => {
            var budget = {steps: 1000};
            var result = await jsonata("[1..10].($ * 2)").evaluate({}, undefined, undefined, budget);
            expect(result).to.deep.equal([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
            expect(budget.stepsUsed).to.be.at.most(1000);
        });

        it("aborts with a distinguishable error when the step limit is exceeded", async () => {
            var budget = {steps: 10};
            var promise = jsonata("[1..1000].($ * 2)").evaluate({}, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps"
            });
            try {
                await promise;
            } catch (err) {
                expect(err.value).to.be.a("number").and.to.be.above(10);
                expect(err.value).to.equal(budget.stepsUsed);
                expect(err.position).to.be.a("number");
                expect(err.message).to.contain("step budget");
                expect(err.message).to.contain(String(err.value));
                expect(err.message).to.contain(String(err.position));
            }
        });

        it("stops a tail-recursive function without overflowing the JS stack", async () => {
            var expression = "( $inf := function() { $inf() }; $inf())";
            var budget = {steps: 200};
            try {
                await jsonata(expression).evaluate({}, undefined, undefined, budget);
                throw new Error("expected the evaluation to be aborted");
            } catch (err) {
                expect(err).to.deep.include({
                    code: "D1014",
                    limit: "steps"
                });
            }
        });

        it("stops the map higher order function part-way through the array", async () => {
            var budget = {steps: 60};
            var promise = jsonata("$map($, function($x) { $x * 2 })")
                .evaluate(new Array(100000).fill(1), undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "map"
            });
            expect(budget.stepsUsed).to.be.below(1000);
        });

        it("stops a map using a registered (native) callback part-way through the array", async () => {
            var expression = jsonata("$map($, $double)");
            expression.registerFunction("double", function(value) {
                return value * 2;
            });
            var budget = {steps: 60};
            await expect(expression.evaluate(new Array(100000).fill(1), undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps",
                    token: "map"
                });
            expect(budget.stepsUsed).to.be.below(1000);
        });

        it("stops the filter higher order function part-way through the array", async () => {
            var budget = {steps: 60};
            var promise = jsonata("$filter($, function($x) { $x % 2 = 0 })")
                .evaluate(new Array(100000).fill(0).map(function(_, i) {
                    return i;
                }), undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "filter"
            });
        });

        it("stops the reduce higher order function part-way through the array", async () => {
            var budget = {steps: 60};
            var promise = jsonata("$reduce($, function($a, $b) { $a + $b })")
                .evaluate(new Array(100000).fill(1), undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "reduce"
            });
        });

        it("stops the single higher order function part-way through the array", async () => {
            var budget = {steps: 60};
            var promise = jsonata("$single($, function($x) { $x = 999999 })")
                .evaluate(new Array(100000).fill(1), undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "single"
            });
        });

        it("stops the sift higher order function while iterating over an object", async () => {
            var input = {};
            for (var i = 0; i < 1000; i++) {
                input["k" + i] = i;
            }
            var budget = {steps: 60};
            var promise = jsonata("$sift($$, function($v) { $v > -1 })")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "sift"
            });
        });

        it("stops the each higher order function while iterating over an object", async () => {
            var input = {};
            for (var i = 0; i < 1000; i++) {
                input["k" + i] = i;
            }
            var budget = {steps: 60};
            var promise = jsonata("$each($$, function($v) { $v })")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "each"
            });
        });

        it("stops sorting while the comparator is still being invoked", async () => {
            var input = new Array(1000).fill(0).map(function(_, i) {
                return i;
            });
            var budget = {steps: 60};
            var promise = jsonata("$sort($, function($a, $b) { $a > $b })")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "sort"
            });
            expect(budget.stepsUsed).to.be.below(5000);
        });

        it("stops the order-by clause while the comparator is still being invoked", async () => {
            var input = {items: []};
            for (var i = 0; i < 1000; i++) {
                input.items.push({value: 1000 - i});
            }
            var budget = {steps: 60};
            var promise = jsonata("items^(value).value")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps"
            });
        });

        it("stops $match while iterating over regex matches", async () => {
            var input = "aaaaaaaaaa";
            var budget = {steps: 5};
            var promise = jsonata("$match($, /a/)")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "match"
            });
        });

        it("stops $split while iterating over regex separators", async () => {
            var input = "a,b,c,d,e,f,g,h,i,j";
            var budget = {steps: 5};
            var promise = jsonata("$split($, /,/)")
                .evaluate(input, undefined, undefined, budget);
            await expect(promise).to.eventually.be.rejected.and.deep.include({
                code: "D1014",
                limit: "steps",
                token: "split"
            });
        });
    });

    describe("recursion depth budget", () => {
        it("allows a recursively defined function within the depth limit", async () => {
            var expression = "" +
                "( $fact := function($n) { $n <= 1 ? 1 : $n * $fact($n - 1) }; $fact(5) )";
            var budget = {depth: 100};
            var result = await jsonata(expression).evaluate({}, undefined, undefined, budget);
            expect(result).to.equal(120);
            expect(budget.depthPeak).to.be.at.most(100);
        });

        it("aborts a non-tail recursive function before the JS stack overflows", async () => {
            var expression = "( $inf := function($n) { $n + $inf($n - 1) }; $inf(5) )";
            var budget = {depth: 50};
            try {
                await jsonata(expression).evaluate({}, undefined, undefined, budget);
                throw new Error("expected the evaluation to be aborted");
            } catch (err) {
                expect(err).to.deep.include({
                    code: "D1015",
                    limit: "depth",
                    token: "inf"
                });
                expect(err.value).to.equal(51);
                expect(err.position).to.be.a("number");
                expect(err.message).to.contain("depth budget");
                expect(err.message).to.contain(String(err.value));
                expect(err.message).to.contain(String(err.position));
            }
        });

        it("aborts a tail-recursive function via the depth limit", async () => {
            var expression = "( $inf := function() { $inf() }; $inf())";
            var budget = {depth: 50};
            await expect(jsonata(expression).evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1015",
                    limit: "depth",
                    token: "inf"
                });
        });

        it("completes a bounded tail-recursive function within the depth limit", async () => {
            var expression = "" +
                "( $countdown := function($n) { $n = 0 ? 'done' : $countdown($n - 1) };" +
                " $countdown(100) )";
            var budget = {depth: 1000, steps: 100000};
            var result = await jsonata(expression).evaluate({}, undefined, undefined, budget);
            expect(result).to.equal("done");
            expect(budget.depthPeak).to.be.at.most(1000);
        });

        it("reports the peak depth when a recursive function is aborted", async () => {
            var expression = "( $inf := function($n) { $n + $inf($n - 1) }; $inf(5) )";
            var budget = {depth: 50};
            await expect(jsonata(expression).evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected;
            expect(budget.depthPeak).to.equal(51);
        });
    });

    describe("allocation pre-checks", () => {
        it("charges $pad before the large string is allocated", async () => {
            var budget = {steps: 100};
            await expect(jsonata("$pad('x', 1000000)").evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps",
                    token: "pad"
                });
        });

        it("still applies the hard 1e7 limit of $pad when no step budget is set", async () => {
            await expect(jsonata("$pad('x', 20000000)").evaluate({}, undefined, undefined, {}))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D2016"
                });
        });

        it("allows $pad within the budget", async () => {
            var budget = {steps: 100};
            var result = await jsonata("$pad('x', 5)").evaluate({}, undefined, undefined, budget);
            expect(result).to.equal("x    ");
        });

        it("charges $join before the joined string is allocated", async () => {
            var input = new Array(100).fill("abcdefgh");
            var budget = {steps: 500};
            await expect(jsonata("$join($, '-')").evaluate(input, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps",
                    token: "join"
                });
        });

        it("allows $join within the budget", async () => {
            var budget = {steps: 100};
            var result = await jsonata("$join(['a', 'b', 'c'], '-')")
                .evaluate({}, undefined, undefined, budget);
            expect(result).to.equal("a-b-c");
        });

        it("charges $replace with a string pattern as the output is built", async () => {
            var budget = {steps: 20};
            await expect(jsonata("$replace('aaaaaaaaaa', 'a', 'XXXXXXXXXX')")
                .evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps",
                    token: "replace"
                });
        });

        it("charges $replace with a regex matcher as the output is built", async () => {
            var budget = {steps: 20};
            await expect(jsonata("$replace('aaaaaaaaaa', /a/, 'XXXXXXXXXX')")
                .evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps",
                    token: "replace"
                });
        });

        it("allows $replace within the budget", async () => {
            var budget = {steps: 100};
            var result = await jsonata("$replace('a-b-c', '-', '_')")
                .evaluate({}, undefined, undefined, budget);
            expect(result).to.equal("a_b_c");
        });

        it("charges the range operator before the sequence is allocated", async () => {
            var budget = {steps: 10};
            await expect(jsonata("[1..1000000]").evaluate({}, undefined, undefined, budget))
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1014",
                    limit: "steps"
                });
        });
    });

    describe("budget validation", () => {
        it("rejects a non-object budget", async () => {
            await expect(jsonata("1").evaluate({}, undefined, undefined, "not-a-budget"))
                .to.eventually.be.rejectedWith(TypeError);
        });

        it("rejects a null budget", async () => {
            await expect(jsonata("1").evaluate({}, undefined, undefined, null))
                .to.eventually.be.rejectedWith(TypeError);
        });

        it("rejects a non-integer steps limit", async () => {
            await expect(jsonata("1").evaluate({}, undefined, undefined, {steps: 1.5}))
                .to.eventually.be.rejectedWith(TypeError);
        });

        it("rejects a non-positive steps limit", async () => {
            await expect(jsonata("1").evaluate({}, undefined, undefined, {steps: 0}))
                .to.eventually.be.rejectedWith(TypeError);
        });

        it("rejects a non-numeric depth limit", async () => {
            await expect(jsonata("1").evaluate({}, undefined, undefined, {depth: "deep"}))
                .to.eventually.be.rejectedWith(TypeError);
        });

        it("accepts a budget containing only a depth limit", async () => {
            var result = await jsonata("1").evaluate({}, undefined, undefined, {depth: 10});
            expect(result).to.equal(1);
        });

        it("accepts a budget containing only a steps limit", async () => {
            var result = await jsonata("1").evaluate({}, undefined, undefined, {steps: 10});
            expect(result).to.equal(1);
        });

        it("accepts an empty budget object and only records the consumption", async () => {
            var budget = {};
            var result = await jsonata("1").evaluate({}, undefined, undefined, budget);
            expect(result).to.equal(1);
            expect(budget.stepsUsed).to.be.a("number").and.to.be.above(0);
            expect(budget.depthPeak).to.be.a("number").and.to.be.above(0);
        });
    });

    describe("no budget supplied", () => {
        it("evaluates asynchronously registered functions unchanged", async () => {
            var compiled = jsonata("$slow($)");
            compiled.registerFunction("slow", async function(value) {
                await new Promise(function(resolve) {
                    setTimeout(resolve, 1);
                });
                return "done:" + value;
            }, "<s:s>");
            var result = await compiled.evaluate("x");
            expect(result).to.equal("done:x");
        });

        it("evaluates lazy (short-circuited) expressions unchanged", async () => {
            var result = await jsonata("false and $undefinedFunction()").evaluate({});
            expect(result).to.equal(false);
        });

        it("evaluates a tail-recursive function to completion unchanged", function() {
            this.timeout(5000);
            var expression = "" +
                "( $countdown := function($n) { $n = 0 ? 'done' : $countdown($n - 1) };" +
                " $countdown(100) )";
            return expect(jsonata(expression).evaluate({})).to.eventually.equal("done");
        });

        it("leaves the existing wall-clock and stack guardrails working", function() {
            this.timeout(5000);
            var options = {timeout: 1000, stack: 300};
            var expression = "( $inf := function($n) { $n + $inf($n - 1) }; $inf(5) )";
            return expect(jsonata(expression, options).evaluate())
                .to.eventually.be.rejected.and.deep.include({
                    code: "D1011"
                });
        });
    });
});
