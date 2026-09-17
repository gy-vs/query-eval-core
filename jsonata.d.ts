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
   * Options accepted by a single `evaluate()` invocation.  The third argument to
   * `evaluate` is either a node-style callback or one of these objects.
   */
  interface JsonataRuntimeOptions {
    /** maximum number of evaluation steps; aborts with code 'D1014' when exceeded */
    steps?: number;
    /** maximum recursion depth; aborts with code 'D1015' when exceeded */
    depth?: number;
    /** optional node-style callback, equivalent to passing the callback directly */
    callback?: (err: JsonataError | null, resp: any) => void;
    /** number of steps consumed, populated when the evaluation finishes */
    stepsUsed?: number;
    /** peak recursion depth reached, populated when the evaluation finishes */
    depthPeak?: number;
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
    evaluate(input: any, bindings: Record<string, any> | undefined, options: JsonataRuntimeOptions): Promise<any>;
    assign(name: string, value: any): void;
    registerFunction(name: string, implementation: (this: Focus, ...args: any[]) => any, signature?: string): void;
    ast(): ExprNode;
  }
}

export = jsonata;
