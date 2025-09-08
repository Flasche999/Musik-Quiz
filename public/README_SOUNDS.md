# Online Musik‑Quiz — Buzz-Anzeige & Sounds

Neu:
- **Global sichtbar**, wer als erstes gebuzzert hat (Banner)
- **Buzzer‑Sound** für alle Clients
- Moderator kann **✅ Richtig** / **❌ Falsch** drücken
- **Ergebnis‑Sound** (Correct/Wrong) für alle Clients
- Banner werden beim „Buzzer freigeben“ wieder ausgeblendet

Hinweis zu Sounds:
- Lege eigene Dateien in `public/sounds/ui/` ab:
  - `buzzer.mp3`
  - `correct.mp3`
  - `wrong.mp3`
- Falls keine Dateien vorhanden sind, gibt es einen **Fallback‑Beep** per WebAudio.
