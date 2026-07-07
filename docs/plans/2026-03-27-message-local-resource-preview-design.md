# Message Local Resource Preview Design

## Goal

Repair local resource interactions inside chat messages so that:

- local image links open the in-app preview modal by default
- local non-image file links still download
- markdown image syntax (`![](...)`) and markdown link syntax (`[](...)`) behave consistently
- preview failures stay in the current chat and show an error state instead of navigating away or forcing a download

## Problem

Local resources can appear in historical Codex and Claude messages as:

- markdown links such as `[image.png](/E:/path/image.png)`
- markdown images such as `![image](/E:/path/image.png)`
- other local file links using Windows paths or `file:///` URLs

The current UI spreads path normalization, image detection, and click routing across multiple code paths. That increases the risk of regressions where some local resources preview correctly while others fall back to browser navigation or fail silently.

## Recommended Approach

Introduce a shared local resource helper for the web app and route all message-level local resource interactions through it.

This helper will:

- normalize local resource paths from markdown links, markdown images, Windows paths, and file URIs
- classify local resources as previewable image vs downloadable file
- preserve external browser links as normal external navigation targets

`App.tsx` will remain responsible for executing the action:

- preview image resources through the existing preview modal
- download non-image resources through the existing file API
- surface preview/download failures through the existing error state

`ChatBubble.tsx` will remain responsible for rendering:

- local markdown links as button-driven in-app actions
- local markdown images as preview buttons instead of native browser navigation
- external links as browser links

## Data Flow

1. Markdown content is rendered in `ChatBubble`.
2. Link and image nodes are classified through shared helper functions.
3. Local resources call `onFileLinkClick(normalizedPath, label)`.
4. `App.tsx` reuses the same helper to decide preview vs download.
5. Image resources open the preview modal.
6. Failures update the UI error state and keep the user in the current chat.

## Error Handling

- Invalid local paths are ignored without browser navigation.
- Preview fetch failures show an error in the existing image preview / files error UI.
- No automatic fallback download is triggered on preview failure.
- External links continue opening in a separate browser context.

## Testing

Add frontend unit tests for:

- local path normalization for `/E:/...`, `E:/...`, and `file:///E:/...`
- previewable image detection by extension
- local vs external link classification

Retain a server-level regression check by validating that historical session file references like `/E:/flux2_test/output_local/chinese_model_seed45.png` still resolve through the file download API after normalization.

## Scope

In scope:

- chat message markdown link/image behavior
- local image preview defaults
- local non-image download behavior
- regression tests for helper logic

Out of scope:

- parsing plain text file paths into clickable links
- changing the file panel interaction model
- changing how recent/session files are indexed on the server
