import { createContext, useContext } from "react";

const ChatPageContext = createContext(false);

export const ChatPageProvider = ChatPageContext.Provider;

// The full-page chat is not one of the shell's chat modes, so components that
// branch on `chat.mode` use this to know they are filling the page.
export function useIsChatPage() {
  return useContext(ChatPageContext);
}
