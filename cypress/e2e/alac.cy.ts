// Does a browser actually play an ALAC file?
//
// Everything else about ALAC is verified in node: the demuxer reads the right track, the
// decoder reproduces the source samples exactly, and the conversion carries them into a
// WAV. None of that proves a browser will play the result, which is the only claim that
// matters to a listener and the one thing node cannot answer.
//
// Chrome has no ALAC decoder, so this exercises the real fallback: playback fails, the file
// is converted in memory, and the converted audio plays.

const FIXTURE = "test-corpus/alac/stereo-16.m4a";
const DURATION = 0.5; // what the corpus generator writes

describe("ALAC playback", () => {
  it("plays a file Chrome cannot decode natively", () => {
    cy.visit("/");

    // Confirm the premise: if Chrome ever gained an ALAC decoder this test would silently
    // stop testing the fallback, so assert that it still cannot play ALAC itself.
    cy.document().then((doc) => {
      const probe = doc.createElement("audio");
      expect(probe.canPlayType('audio/mp4; codecs="alac"'), "Chrome still lacks ALAC").to.equal("");
    });

    cy.get("#file").selectFile(FIXTURE, { force: true });

    // The player mounts an <audio> element; the conversion happens behind an error event,
    // so allow generous time for the wasm fetch and the decode.
    cy.get("#player audio", { timeout: 30000 }).should("exist");

    // readyState >= 2 (HAVE_CURRENT_DATA) means the browser has actually decoded audio,
    // not merely accepted a URL.
    cy.get("#player audio", { timeout: 30000 })
      .should((els) => {
        const audio = els[0] as HTMLAudioElement;
        expect(audio.readyState, "decoded enough to play").to.be.gte(2);
        expect(audio.duration, "duration").to.be.closeTo(DURATION, 0.15);
      });

    // And it advances when played, which is the difference between "loaded" and "playing".
    cy.get("#player audio").then(async (els) => {
      const audio = els[0] as HTMLAudioElement;
      audio.muted = true;
      await audio.play();
    });
    cy.wait(600);
    cy.get("#player audio").should((els) => {
      const audio = els[0] as HTMLAudioElement;
      expect(audio.currentTime, "playback advanced").to.be.greaterThan(0);
    });
  });
});
