# A timed power-up runs out: the pickup played backwards and softly — a short
# downward glide from D5 to G4 through a closing filter. A notice, not an
# alarm; it should be easy to miss in a busy rally.
with_fx :reverb, room: 0.5, mix: 0.3 do
  with_fx :lpf, cutoff: 95, cutoff_slide: 0.3 do |f|
    s = synth :sine, note: :d5, note_slide: 0.25, attack: 0.01, release: 0.35, amp: 0.35
    control s, note: :g4
    synth :tri, note: :d5, note_slide: 0.25, attack: 0.01, release: 0.3, amp: 0.12
    control f, cutoff: 70
  end
end
