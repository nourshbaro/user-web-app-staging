import { createContext, PropsWithChildren, useContext, useState } from "react";
import { CartSheet } from "@/components/CartSheet";

type CartSheetContextValue = {
  openCartSheet: () => void;
  closeCartSheet: () => void;
};

const CartSheetContext = createContext<CartSheetContextValue | null>(null);

export function CartSheetProvider({ children }: PropsWithChildren) {
  const [visible, setVisible] = useState(false);

  return (
    <CartSheetContext.Provider value={{ openCartSheet: () => setVisible(true), closeCartSheet: () => setVisible(false) }}>
      {children}
      <CartSheet visible={visible} onClose={() => setVisible(false)} />
    </CartSheetContext.Provider>
  );
}

export function useCartSheet() {
  const context = useContext(CartSheetContext);
  if (!context) throw new Error("useCartSheet must be used inside CartSheetProvider");
  return context;
}
