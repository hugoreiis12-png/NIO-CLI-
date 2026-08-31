/**
 * Markdown mínimo → Ink. Cobre o que o assistant costuma mandar: blocos de código
 * ```…```, **negrito**, `código inline`, e `# títulos`. Sem dependência.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from './theme.js';

function inline(text: string, key: number): React.ReactNode {
  // parte em **bold** e `code`, alternando
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <Text key={key}>
      {parts.map((p, i) => {
        if (p.startsWith('**') && p.endsWith('**')) return <Text key={i} bold>{p.slice(2, -2)}</Text>;
        if (p.startsWith('`') && p.endsWith('`')) return <Text key={i} color={theme.accent}>{p.slice(1, -1)}</Text>;
        return <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

export function Markdown({ text }: { text: string }): React.ReactElement {
  const blocks: React.ReactNode[] = [];
  const segments = text.split(/```/g);
  segments.forEach((seg, i) => {
    if (i % 2 === 1) {
      // bloco de código: 1ª linha pode ser a linguagem
      const lines = seg.replace(/^\n/, '').split('\n');
      if (lines.length && /^[a-z0-9+-]*$/i.test(lines[0]!.trim()) && lines[0]!.trim().length < 12) lines.shift();
      blocks.push(
        <Box key={`c${i}`} borderStyle="round" borderColor={theme.dim} paddingX={1} flexDirection="column">
          {lines.map((l, j) => (
            <Text key={j} color={theme.dim}>{l || ' '}</Text>
          ))}
        </Box>,
      );
      return;
    }
    seg.split('\n').forEach((line, j) => {
      if (!line.trim()) {
        blocks.push(<Text key={`b${i}-${j}`}> </Text>);
        return;
      }
      const h = /^(#{1,3})\s+(.*)/.exec(line);
      if (h) {
        blocks.push(<Text key={`h${i}-${j}`} bold color={theme.accentBright}>{h[2]}</Text>);
        return;
      }
      blocks.push(inline(line, i * 1000 + j));
    });
  });
  return <Box flexDirection="column">{blocks}</Box>;
}
