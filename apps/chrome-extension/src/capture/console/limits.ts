/** Capture-time console bounds. Entry/message caps match DebugSessionV1. */

export const MAX_CONSOLE_ENTRIES = 50;
export const MAX_CONSOLE_MESSAGE_LENGTH = 4096;
export const MAX_CONSOLE_STACK_LENGTH = 2048;

export const SERIALIZER_MAX_DEPTH = 4;
export const SERIALIZER_MAX_PROPERTIES = 20;
export const SERIALIZER_MAX_ARRAY_LENGTH = 20;
export const SERIALIZER_MAX_STRING_LENGTH = 256;
export const SERIALIZER_MAX_TOTAL_CHARS = 2048;

export const CONSOLE_DEDUP_WINDOW_MS = 250;
export const CONSOLE_DEDUP_MEMORY = 16;

export const CONSOLE_EVENT_NAME = "bdb:console";
export const CONSOLE_STOP_EVENT_NAME = "bdb:console-stop";

export const UNSERIALIZABLE_PLACEHOLDER = "[Unserializable value]";
export const CIRCULAR_PLACEHOLDER = "[Circular]";
export const MAX_DEPTH_PLACEHOLDER = "[MaxDepth]";
