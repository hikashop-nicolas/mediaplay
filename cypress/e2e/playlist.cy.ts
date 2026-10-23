// A queue in a real browser: the part node cannot check, which is that tracks actually play
// one after another, that the controls drive them, and that a playlist file with a gap in it
// still plays through.

const TONES = ["test-corpus/playlist/01 Tone 1.wav", "test-corpus/playlist/02 Tone 2.wav", "test-corpus/playlist/03 Tone 3.wav"];

interface Handle {
  getIndex(): number;
  getRepeat(): string;
  getMediaElement(): HTMLAudioElement;
  setRepeat(mode: string): void;
}

const handle = (): Cypress.Chainable<Handle> =>
  cy.window().then((w) => (w as unknown as { mediaHandle: Handle }).mediaHandle);

/** Retries until the check passes: a .then in front of .should would run it only once. */
const until = (check: (h: Handle) => void) =>
  cy.window().should((w) => check((w as unknown as { mediaHandle: Handle }).mediaHandle));

/** Jump near the end of the track that is playing, so the test does not wait out each one. */
const nearEnd = () => {
  // Muted playback is always allowed, and it is what gets the file's length loaded.
  handle().then((h) => {
    h.getMediaElement().muted = true;
    void h.getMediaElement().play();
  });
  until((h) => expect(Number.isFinite(h.getMediaElement().duration), "metadata loaded").to.equal(true));
  handle().then((h) => {
    const m = h.getMediaElement();
    m.currentTime = Math.max(0, m.duration - 0.25);
  });
};

describe("a queue of audio files", () => {
  beforeEach(() => {
    cy.visit("/");
    cy.window().then((w) => w.localStorage.clear());
    cy.get("#file").selectFile(TONES, { force: true });
    cy.get("#player audio").should("exist");
  });

  it("offers the queue controls, and plays the first file", () => {
    until((h) => expect(h.getIndex()).to.equal(0));
    cy.get('.ot-pl-btn[aria-label="Next"]').should("be.visible");
    cy.get('.ot-pl-btn[aria-label="Previous"]').should("be.visible");
    cy.get('.ot-pl-btn[aria-label="Shuffle"]').should("be.visible");
    cy.get('.ot-pl-now').should("contain.text", "1 / 3");
  });

  it("moves with Next, Previous and the N and P keys", () => {
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    until((h) => expect(h.getIndex()).to.equal(1));
    cy.get("body").type("n");
    until((h) => expect(h.getIndex()).to.equal(2));
    cy.get("body").type("p");
    until((h) => expect(h.getIndex()).to.equal(1));
  });

  it("goes on to the next file by itself when one ends", () => {
    nearEnd();
    until((h) => expect(h.getIndex()).to.equal(1));
  });

  it("stops after the last file with repeat off, and wraps with repeat all", () => {
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    nearEnd();
    cy.wait(900);
    until((h) => expect(h.getIndex(), "still on the last").to.equal(2));
    handle().then((h) => h.setRepeat("all"));
    nearEnd();
    until((h) => expect(h.getIndex(), "wrapped").to.equal(0));
  });

  it("loops one file with repeat one", () => {
    handle().then((h) => h.setRepeat("one"));
    handle().then((h) => expect(h.getMediaElement().loop).to.equal(true));
    nearEnd();
    cy.wait(900);
    until((h) => expect(h.getIndex()).to.equal(0));
  });

  it("goes back to the first file when Next is pressed on the last, with repeat off", () => {
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    until((h) => expect(h.getIndex()).to.equal(2));
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    until((h) => expect(h.getIndex(), "wrapped by hand").to.equal(0));
  });

  it("cycles repeat with its button, and says which mode it is in", () => {
    cy.get('.ot-pl-btn[aria-label="Repeat: off"]').first().click();
    cy.get('.ot-pl-btn[aria-label="Repeat: all"]').first().click();
    cy.get('.ot-pl-btn[aria-label="Repeat: one"]').first().click();
    cy.get('.ot-pl-btn[aria-label="Repeat: off"]').should("exist");
  });

  it("lists the files, jumps to one, and removes one", () => {
    cy.get('.ot-pl-btn[aria-label="Playlist"]').click();
    cy.get(".ot-pl-item").should("have.length", 3);
    cy.get(".ot-pl-item").eq(2).find(".ot-pl-pick").click();
    until((h) => expect(h.getIndex()).to.equal(2));
    cy.get(".ot-pl-item").eq(0).find(".ot-pl-del").click();
    cy.get(".ot-pl-item").should("have.length", 2);
    until((h) => expect(h.getIndex(), "the playing file is now the second").to.equal(1));
  });

  it("tells a screen reader which file started", () => {
    cy.get(".ot-pl-live").should("have.attr", "aria-live", "polite").and("contain.text", "1 / 3");
    cy.get('.ot-pl-btn[aria-label="Next"]').click();
    cy.get(".ot-pl-live").should("contain.text", "2 / 3");
  });

  it("moves focus into the list when it opens, and back to its button when it closes", () => {
    cy.get('.ot-pl-btn[aria-label="Playlist"]').click();
    cy.focused().should("have.class", "ot-pl-pick");
    cy.focused().type("{esc}");
    cy.focused().should("have.attr", "aria-label", "Playlist");
    cy.get(".ot-pl-panel").should("not.be.visible");
  });

  it("remembers shuffle and repeat for the next time", () => {
    cy.get('.ot-pl-btn[aria-label="Shuffle"]').first().click();
    cy.get('.ot-pl-btn[aria-label="Repeat: off"]').first().click();
    cy.window().then((w) => {
      expect(w.localStorage.getItem("mediaplay.shuffle")).to.equal("1");
      expect(w.localStorage.getItem("mediaplay.repeat")).to.equal("all");
    });
  });
});

describe("a playlist file", () => {
  it("plays through the files it can find and shows the one it cannot", () => {
    cy.visit("/");
    cy.window().then((w) => w.localStorage.clear());
    cy.get("#file").selectFile(["test-corpus/playlist/mix.m3u8", ...TONES], { force: true });
    cy.get("#player audio").should("exist");
    cy.get(".ot-pl-now").should("contain.text", "Band - First");
    cy.get('.ot-pl-btn[aria-label="Playlist"]').click();
    cy.get(".ot-pl-item").should("have.length", 4);
    cy.get(".ot-pl-item.off").should("have.length", 1);
    // Two Nexts from the second entry skip the missing one and land on the fourth.
    cy.get('.ot-pl-btn[aria-label="Next"]').first().click();
    cy.get('.ot-pl-btn[aria-label="Next"]').first().click();
    until((h) => expect(h.getIndex()).to.equal(3));
  });
});

describe("one file", () => {
  it("plays as it always did, with no queue controls", () => {
    cy.visit("/");
    cy.get("#file").selectFile(TONES[0]!, { force: true });
    cy.get("#player audio").should("exist");
    cy.get(".ot-pl-btn").should("not.exist");
  });
});
