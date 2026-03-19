# 🦋 react-fly

**Preview your React components on the fly!**

`react-fly` helps you quickly visualize a `.jsx` or `.tsx` file containing a React component without the hassle of setting up an entire build environment.

Supports **Node.js**, **Deno**, and **Bun**.

## Usage

Using `npx` (Node/Deno):

```bash
npx react-fly <path-to-file> -p <port-number> -rv <react-version> -w <watch-changes-boolean>
```

Using `bunx` (Bun):

```bash
bunx react-fly <path-to-file> -p <port-number> -rv <react-version> -w <watch-changes-boolean>
```

Using `dx` (Deno):

```bash
dx react-fly <path-to-file> -p <port-number> -rv <react-version> -w <watch-changes-boolean>
```