export type AuthenticationSnapshot = {
  generation: number;
  token: string | null;
};

export function createAuthenticationAuthority() {
  let generation = 0;

  return {
    currentGeneration() {
      return generation;
    },
    capture(token: string | null): AuthenticationSnapshot {
      return { generation, token };
    },
    replace(token: string | null): AuthenticationSnapshot {
      generation += 1;
      return { generation, token };
    },
    claim(snapshot: AuthenticationSnapshot): AuthenticationSnapshot | null {
      if (snapshot.generation !== generation) return null;
      generation += 1;
      return { generation, token: snapshot.token };
    },
    isCurrent(snapshot: AuthenticationSnapshot) {
      return snapshot.generation === generation;
    },
  };
}