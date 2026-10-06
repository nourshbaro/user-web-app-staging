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
  /**
   * Scheduled-list live fields (`GET /matches/scheduled?status=live`). The
   * list is FLAT; the single-match response nests them under `clock`
   * (`ApiMatchDetail`). Never assume one shape from the other.
   */
  clock_minute?: number | null;
  clock_running?: boolean | null;
  clock_updated_at?: string | null;
};

export type ApiCompetition = {
  id: number;
  name: string;
  short_name?: string | null;
  slug?: string | null;
  logo?: string | null;
};

export type ApiSeason = {
  id: number;
  label: string;
  is_current?: boolean;
};

/** Live clock on the single-match response. `minute` is null when the backend has none. */
export type ApiMatchClock = {
  minute: number | null;
  running: boolean;
};

/** Per-team statistic pair; either side may be null (not supplied — never zero). */
export type ApiStatPair = { home: number | null; away: number | null } | null;

export type ApiMatchStats = {
  possession?: ApiStatPair;
  shots?: ApiStatPair;
  shots_on_target?: ApiStatPair;
  corners?: ApiStatPair;
  fouls?: ApiStatPair;
};

export type ApiEventPlayer = { id: number; name: string; shirt_number?: number | null };

/**
 * One single-match event (confirmed shape, 2026-09-30, matches 16 and 17).
 * Known types: "goal", "yellow_card", "red_card", "substitution" (which uses
 * `player_in` / `player_out`, with `player: null`). Any other type must
 * degrade without meaning (`timelineKind`).
 */
export type ApiMatchEvent = {
  id: number;
  type: string;
  team?: { id: number; name: string; short_name?: string | null; logo?: string | null } | null;
  player?: ApiEventPlayer | null;
  player_in?: ApiEventPlayer | null;
  player_out?: ApiEventPlayer | null;
  minute?: number | null;
  extra_minute?: number | null;
};

/**
 * `GET /matches/single/{id}` (confirmed 2026-09-30). A superset of the list
 * match: competition, season, matchday, nested live clock, events and stats.
 */
export type ApiMatchDetail = ApiMatch & {
  competition?: ApiCompetition | null;
  season?: ApiSeason | null;
  matchday?: number | null;
  round_name?: string | null;
  matchday_label?: string | null;
  clock?: ApiMatchClock | null;
  events?: ApiMatchEvent[] | null;
  stats?: ApiMatchStats | null;
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
  /**
   * Backend QR image. May be absent / null / empty in the list response; the
   * screen then takes it from `GET /portal/tickets/{ticket_code}`
   * (`withBackendQrs`). Rendered only through `ticketQrSource`.
   */
  qr_image?: string | null;
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
  /** Null on a phone-only account (email is optional at registration). */
  email: string | null;
  phone: string | null;
  avatar: string | null;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type RegisterRequest = {
  name: string;
  /** Optional; omitted when the user gives none. */
  email?: string;
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
