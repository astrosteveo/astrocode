import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./code";

// react-markdown never renders raw HTML from the text, which matters here: tool
// output can carry anything, and this page can approve commands.
const components: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  pre: ({ children }) => <CodeFrame>{children}</CodeFrame>,
};

const plugins = [remarkGfm];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

function CodeFrame({ children }: { children?: ReactNode }) {
  const [child] = Children.toArray(children);
  const props = isValidElement<{ className?: string; children?: ReactNode }>(child) ? child.props : {};
  const language = /language-([\w+#-]+)/.exec(props.className ?? "")?.[1];
  const code = Children.toArray(props.children).join("").replace(/\n$/, "");
  return (
    <figure className="code">
      <figcaption>
        <span>{language ?? "text"}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
