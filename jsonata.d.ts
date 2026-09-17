// Type definitions for jsonata 2.2
// Project: https://github.com/jsonata-js/jsonata
// Definitions by: Nick <https://github.com/nick121212> and Michael M. Tiller <https://github.com/xogeny>

declare function jsonata(str: string, options?: jsonata.JsonataOptions): jsonata.Expression;
declare namespace jsonata {

  interface JsonataOptions {
    recover?: boolean;
    RegexEngine?: RegExpConstructor;
    timeout?: number;
    stack?: number;
    sequence?: number;
  }

  interface ExprNode {
    type:
        | "binary"
        | "unary"
        | "function"
        | "partial"
        | "lambda"
        | "condition"
        | "transform"
        | "block"
        | "name"
        | "parent"
        | "string"
        | "number"
        | "value"
        | "wildcard"
        | "descendant"
        | "variable"
        | "regexp"
        | "operator"
        | "error";
    value?: any;
    position?: number;
    arguments?: ExprNode[];
    name?: string;
    procedure?: ExprNode;
    steps?: ExprNode[];
    expressions?: ExprNode[];
    stages?: ExprNode[];
    lhs?: ExprNode | ExprNode[] | [ExprNode, ExprNode][];
    rhs?: ExprNode;
  }

  interface JsonataError extends Error {
    code: string;
    position: number;
    token: string;
  }

  /**
   * Deterministic evaluation budget.  After `evaluate` settles (whether it
   * resolves or rejects), the same object is annotated with the consumed
   * `stepsUsed` and the peak recursion depth `depthPeak`.
   */
  interface EvaluationBudget {
    /** Maximum number of evaluation steps before the evaluation is aborted */
    steps?: number;
    /** Maximum recursion depth before the evaluation is aborted */
    depth?: number;
    /** Number of steps consumed by the evaluation (set on completion) */
    stepsUsed?: number;
    /** Peak recursion depth reached during the evaluation (set on completion) */
    depthPeak?: number;
  }

  interface BudgetExceededError extends JsonataError {
    /** Which limit was exceeded: 'steps' or 'depth' */
    limit: "steps" | "depth";
  }

  interface Environment {
    bind(name: string | symbol, value: any): void;
    lookup(name: string | symbol): any;
    readonly timestamp: Date;
    readonly async: boolean;
  }

  interface Focus {
    readonly environment: Environment;
    readonly input: any;
  }

  interface Expression {
    evaluate(input: any, bindings?: Record<string, any>): Promise<any>;
    evaluate(input: any, bindings: Record<string, any> | undefined, callback: (err: JsonataError, resp: any) => void): void;
    evaluate(
      input: any,
      bindings: Record<string, any> | undefined,
      callback: ((err: JsonataError, resp: any) => void) | undefined,
      budget: EvaluationBudget
    ): Promise<any>;
    assign(name: string, value: any): void;
    registerFunction(name: string, implementation: (this: Focus, ...args: any[]) => any, signature?: string): void;
    ast(): ExprNode;
  }
}

export = jsonata;
