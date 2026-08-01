declare namespace React {
  type ReactNode = unknown;
  interface SyntheticEvent<T = Element> { readonly currentTarget: T; readonly target: EventTarget & T; }
  interface MouseEvent<T = Element> extends SyntheticEvent<T> {}
  interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  interface ComponentLifecycle<P, S> {
    componentDidMount?(): void;
    componentWillUnmount?(): void;
  }
  class Component<P = Record<string, never>, S = Record<string, unknown>> implements ComponentLifecycle<P, S> {
    constructor(props: P);
    readonly props: Readonly<P>;
    state: Readonly<S>;
    setState<K extends keyof S>(state: Pick<S, K> | S | ((previous: Readonly<S>, props: Readonly<P>) => Pick<S, K> | S | null)): void;
    forceUpdate(): void;
    render(): ReactNode;
  }
  function createElement(type: unknown, props?: unknown, ...children: unknown[]): unknown;
}
declare const React: { Component: typeof React.Component; createElement: typeof React.createElement };
declare const ReactDOM: { render(element: unknown, container: Element | null): void; unmountComponentAtNode(container: Element): boolean };
declare namespace JSX {
  type Element = unknown;
  interface IntrinsicAttributes { key?: string | number; }
  interface ElementChildrenAttribute { children: unknown; }
  interface IntrinsicElements { [elementName: string]: any; }
}
