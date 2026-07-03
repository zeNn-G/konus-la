import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MENTION_HREF_PREFIX = "#mention-";

/**
 * Turn known-member `@username` occurrences into markdown links (`#mention-` hrefs) that the
 * renderer styles as pills. Code spans/fences are left untouched so `@foo` inside backticks
 * stays literal — mirroring the server, which also counts mentions on the raw source.
 */
function linkifyMentions(source: string, memberUsernames: ReadonlySet<string>): string {
  return source
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replaceAll(/@([a-z0-9_]{3,20})/g, (whole, username: string) =>
            memberUsernames.has(username)
              ? `[${whole}](${MENTION_HREF_PREFIX}${username})`
              : whole,
          ),
    )
    .join("");
}

/**
 * Message body: basic markdown (GFM), rendered from the raw source stored in the DB.
 * No raw HTML pass-through (react-markdown escapes it by default) and no images —
 * attachments are post-v1, so an image URL stays a link.
 */
export function MessageMarkdown({
  content,
  memberUsernames,
}: {
  content: string;
  memberUsernames: ReadonlySet<string>;
}) {
  return (
    <div className="prose-sm max-w-none space-y-1 break-words [&_blockquote]:border-l-2 [&_blockquote]:border-foreground/20 [&_blockquote]:pl-2 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        allowedElements={[
          "p",
          "a",
          "strong",
          "em",
          "del",
          "code",
          "pre",
          "ul",
          "ol",
          "li",
          "blockquote",
          "br",
          "hr",
        ]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(MENTION_HREF_PREFIX)) {
              return (
                <span className="rounded bg-blue-500/15 px-1 font-medium text-blue-600 dark:text-blue-400">
                  {children}
                </span>
              );
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline dark:text-blue-400"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {linkifyMentions(content, memberUsernames)}
      </Markdown>
    </div>
  );
}
