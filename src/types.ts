export type ApiTeam = {
  id: number;
  name: string;
  short_name?: string | null;
  logo?: string | null;
  slug?: string;
};

export type ApiStadium = {
  id: number;
  name: string;
  location?: string;
  map_image?: string | null;
  mapImageUrl?: string | null;
  slug?: string;
  zones?: ApiZone[];
};

export type ApiMatch = {
  id: number;
  match_date: string;
  kickoff_at: string;
  status: string;
  home_team: ApiTeam;
  away_team: ApiTeam;
  stadium?: ApiStadium;
  /** Backend scores: numbers once a match has a result (e.g. `completed`), otherwise null. */
  home_score?: number | null;
  away_score?: number | null;
};

export type PortalMatchTeam = {
  id: number;
  name: string;
  logo: string | null;
};

export type PortalMatch = {
  match_id: number;
  kickoff_at: string;
  is_upcoming: boolean;
  status: string;
  home_team: PortalMatchTeam;
  away_team: PortalMatchTeam;
  stadium: string | null;
  ticket_count: number;
};

export type PortalTicketMatch = {
  id: number;
  kickoff_at: string;
  home_team: string;
  home_team_logo: string | null;
  away_team: string;
  away_team_logo: string | null;
};

export type PortalTicketZone = {
  id: number;
  name: string;
};

export type PortalTicketSeat = Record<string, unknown> | null;

export type PortalTicket = {
  ticket_code: string;
  holder_name: string;
  status: string;
  order_code: string;
  match: PortalTicketMatch;
  zone: PortalTicketZone;
  seat: PortalTicketSeat;
  checked_in_at: string | null;
  created_at: string;
  qr_image: string;
};

export type PortalTicketsMeta = {
  page: number;
  per_page: number;
  total: number;
  last_page: number;
};

export type PortalTicketsResponse = {
  data: PortalTicket[];
  meta: PortalTicketsMeta;
};

export type ApiZone = {
  id: number;
  name: string;
  has_seats: boolean;
  shape_type?: string;
  shape_data?: { x: number; y: number }[];
  price: string;
  currency: string;
  capacity?: string | null;
};

export type ApiSeat = {
  id: number;
  row: string;
  number: string;
  label?: string;
  x?: string | number;
  y?: string | number;
  status: "available" | "reserved" | "booked" | "locked" | "sold" | string;
};

export type FilterOption = {
  id: string;
  name: string;
  slug: string;
};

/**
 * `/matches/scheduled?status=` values the backend accepts (it rejects any
 * other value with 422). Omitted = the default scheduled (upcoming) list.
 */
export type MatchStatusFilter = "live" | "completed";

export type MatchFilters = {
  team?: string;
  stadium?: string;
  date?: string;
  /** Upcoming (omitted), Live or Results; composes with the other filters server-side. */
  status?: MatchStatusFilter;
};

export type CartItem = {
  lock_key: string;
  match_id: string;
  stadium_zone_id: string;
  type: "zone" | "seat" | "seats";
  quantity: string | number;
  seat_ids?: number[];
  zone_name?: string;
  seats?: { id: string; row: string; number: string; label?: string }[];
  unit_price: number;
  currency: string;
  subtotal: number;
  match_title?: string;
};

export type CartResponse = {
  checkout_session_id: string;
  match_id?: string;
  expires_at: string;
  cart: {
    items?: CartItem[];
    matches?: {
      match_id: number | string;
      match_info?: { home_team?: string; away_team?: string; kickoff_at?: string };
      items?: CartItem[];
      subtotal?: number;
      currency?: string;
    }[];
    total: number;
    currency: string | null;
    max_tickets?: number;
  };
};

export type AddCartRequest = {
  match_id?: number;
  checkout_session_id?: string;
  stadium_zone_id: number;
  quantity?: number;
  seat_ids?: number[];
};

export type UpdateCartRequest = {
  quantity?: number;
  seat_ids?: number[];
};

export type User = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RegisterRequest = {
  name: string;
  email: string;
  password: string;
  password_confirmation: string;
  /** Normalized international number as digits only, no leading "+". */
  phone: string;
};

export type CheckoutSubmitRequest = {
  checkout_session_id: string;
  billing: {
    name: string;
    email: string;
    phone: string;
    address1?: string;
    locality?: string;
    administrative_area?: string;
    postal_code?: string;
    country: string;
  };
  tickets_by_match: Record<string, { holder_name: string }[]>;
  payment_method: "cybersource" | "blue";
  payment?: { transient_token?: string };
};

export type CheckoutSubmitResponse = {
  order_id?: string | number;
  order_number?: string | number;
  reference?: string | number;
  payment_reference?: string | number;
  status?: string;
  payment_redirect_validated?: boolean;
  payment?: {
    payment_url?: string;
    reference?: string | number;
    payment_reference?: string | number;
    status?: string;
    payment_redirect_validated?: boolean;
  };
};

export type Order = {
  id: number;
  status?: string;
  total?: number;
  currency?: string;
  created_at?: string;
  match?: ApiMatch;
  tickets?: unknown[];
};
