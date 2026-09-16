// Built-in component schemas, the single source of truth for both sides (docs/components.md).
// Regenerate with `pnpm schema` at the repo root; CI checks the generated files are current.
import Column from "./components/column.ts";
import Row from "./components/row.ts";
import Box from "./components/box.ts";
import Text from "./components/text.ts";
import Button from "./components/button.ts";
import TextField from "./components/text-field.ts";
import LazyColumn from "./components/lazy-column.ts";
import Spacer from "./components/spacer.ts";

export default [Column, Row, Box, Text, Button, TextField, LazyColumn, Spacer];
