import { useI18n } from "@/i18n/I18nProvider";
import { createContext, PropsWithChildren, useCallback, useContext, useMemo, useState } from "react";
import { useCart } from "@/context/CartContext";
import { deriveTicketSlots, type TicketSlot } from "@/lib/ticketHolders";

/**
 * Single owner of ticket-holder names for the checkout flow.
 *
 * Previously this state lived only as local `useState` inside the Checkout
 * screen. Now that names are collected in a dedicated step-by-step flow
 * *before* Checkout, and can also be edited *from* Checkout, both surfaces
 * need to read/write the same state — so it is hoisted here instead of
 * being duplicated in two places. `ticketSlots` (one entry per physical
 * ticket/seat) is derived from the cart, the same existing source of truth
 * CartContext already owns; this context does not introduce a second cart.
 */
type TicketHoldersContextValue = {
  ticketSlots: TicketSlot[];
  holderNames: Record<string, string>;
  setHolderName: (key: string, value: string) => void;
  initializeFirstHolder: (key: string, value: string) => void;
  resetHolderNames: () => void;
};

const TicketHoldersContext = createContext<TicketHoldersContextValue | null>(null);

export function TicketHoldersProvider({ children }: PropsWithChildren) {
  const cart = useCart();
  const { t } = useI18n();
  const [holderState, setHolderState] = useState<{
    names: Record<string, string>;
    initializedFirstHolders: Record<string, true>;
  }>({ names: {}, initializedFirstHolders: {} });
  const holderNames = holderState.names;
  const ticketSlots = useMemo(() => deriveTicketSlots(cart.items, t), [cart.items, t]);

  const setHolderName = useCallback((key: string, value: string) => {
    setHolderState((current) => ({ ...current, names: { ...current.names, [key]: value } }));
  }, []);

  const initializeFirstHolder = useCallback((key: string, value: string) => {
    setHolderState((current) => {
      if (current.initializedFirstHolders[key]) return current;
      return {
        names: current.names[key]?.trim() ? current.names : { ...current.names, [key]: value },
        initializedFirstHolders: { ...current.initializedFirstHolders, [key]: true },
      };
    });
  }, []);

  const resetHolderNames = useCallback(() => {
    setHolderState({ names: {}, initializedFirstHolders: {} });
  }, []);

  const value = useMemo<TicketHoldersContextValue>(() => ({
    ticketSlots,
    holderNames,
    setHolderName,
    initializeFirstHolder,
    resetHolderNames,
  }), [holderNames, initializeFirstHolder, resetHolderNames, setHolderName, ticketSlots]);

  return <TicketHoldersContext.Provider value={value}>{children}</TicketHoldersContext.Provider>;
}

export function useTicketHolders() {
  const context = useContext(TicketHoldersContext);
  if (!context) throw new Error("useTicketHolders must be used inside TicketHoldersProvider");
  return context;
}
