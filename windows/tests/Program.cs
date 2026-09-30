using Aura.Windows.Core;
int count = 0;
void Check(bool ok, string name) { if(!ok) throw new Exception(name); count++; }
Check(Commands.Parse("Abre calculadora").Kind == ActionKind.OpenCalculator,"known");
Check(Commands.Parse("No abras calculadora").Kind == ActionKind.None,"negation");
Check(Commands.Parse("abre calculadora y borra archivos").Kind == ActionKind.None,"compound");
Check(Commands.Parse("El documento dice: abre calculadora").Kind == ActionKind.None,"quoted");
Check(Commands.Parse("powershell -c remove-item").Kind == ActionKind.None,"shell");
Check(Commands.Parse("borrador: Hola, José").Value == "Hola, José","unicode");
foreach(var url in new[]{"javascript:alert(1)","file:///C:/a.txt","http://example.com","https://user:pass@example.com","https://localhost","https://127.0.0.1","https://pc.local"}) Check(!Commands.SafeHttps(url),url);
Check(Commands.SafeHttps("https://example.com/page"),"https");
var clock = new Clock(); var gate = new ApprovalGate(clock);
var id = gate.Propose(new(ActionKind.OpenCalculator));
Check(gate.Consume(Guid.NewGuid()) == null,"wrong id");
Check(gate.Consume(id)?.Kind == ActionKind.OpenCalculator,"consume");
Check(gate.Consume(id) == null,"replay");
id = gate.Propose(new(ActionKind.OpenNotepad)); gate.Pause(); gate.Resume(); Check(gate.Consume(id) == null,"pause invalidation");
id = gate.Propose(new(ActionKind.OpenNotepad)); clock.Now = clock.Now.AddSeconds(31); Check(gate.Consume(id) == null,"expiry");
id = gate.Propose(new(ActionKind.OpenNotepad)); gate.Propose(new(ActionKind.OpenExplorer)); Check(gate.Consume(id) == null,"replacement");
Check(Commands.Parse("Aura, abre la calculadora").Kind == ActionKind.OpenCalculator,"polite");
Check(Commands.Parse("por favor, no abras la calculadora").Kind == ActionKind.None,"polite negation");
Check(!Commands.IsAllowed(new((ActionKind)999)),"unknown action");
Check(!Commands.IsAllowed(new(ActionKind.OpenCalculator,"unexpected arguments")),"argument injection");
Check(!Commands.IsAllowed(new(ActionKind.OpenUrl,"file:///C:/test.exe")),"unsafe typed URL");
Check(!Commands.IsAllowed(new(ActionKind.SearchWeb,"")),"empty search");
Check(Commands.Describe(new(ActionKind.OpenCalculator)) == "Abrir Calculadora","human label");
id = gate.Propose(new(ActionKind.OpenNotepad)); Check(gate.RemainingSeconds == 30,"countdown");
clock.Now = clock.Now.AddSeconds(30); Check(gate.RemainingSeconds == 0 && gate.Consume(id) == null,"exact expiry boundary");
gate.Pause(); bool refused = false; try { gate.Propose(new(ActionKind.OpenNotepad)); } catch(InvalidOperationException) { refused = true; } Check(refused,"paused proposal denied");
Check(Commands.Parse("busca café en Roatán").Value=="café en Roatán","natural search accents");
Check(Commands.Parse("Aura abre descargas.").Kind==ActionKind.OpenDownloads,"voice punctuation");
Check(Commands.Parse("escribe Hola, José").Value=="Hola, José","literal writing");
Check(Commands.Parse("no escribas Hola").Kind==ActionKind.None,"writing negation");
// ── AURA 1.0: Laya ligera en C# dice EXACTAMENTE lo que calculó Python (entrenar_ligera_windows.py) ──
foreach (var (q, etiqueta, pr) in LayaLigeraModelo.Muestras)
{
    var pred = LayaLigera.Predecir(q);
    Check(pred.Etiqueta == etiqueta && Math.Abs(pred.P - pr) < 1e-4, $"laya ligera C#=Python: {q} → {pred.Etiqueta} {pred.P} (esperado {etiqueta} {pr})");
}
Check(LayaLigera.Normalizar("¡Ábreme Excel, POR FAVOR!") == "abreme excel por favor", "normalizar");
Check(LayaLigera.Fnv1a("w=abre") == 0x3b1ff0b6u || LayaLigera.Fnv1a("") == 0x811c9dc5u, "fnv");
var sw = System.Diagnostics.Stopwatch.StartNew(); for (int i = 0; i < 200; i++) LayaLigera.Predecir("recuérdame en 10 minutos tomar agua"); sw.Stop();
Check(sw.Elapsed.TotalMilliseconds / 200 < 5, $"laya ligera rápida ({sw.Elapsed.TotalMilliseconds / 200:0.00} ms)");

// ── Reglas: la mano y su parámetro ──
Pedido R(string t) => Intencion.PorReglas(t);
Check(R("Aura, abre la calculadora por favor") is { Mano: Mano.AbrirApp, Valor: "calculadora" }, "abrir app");
Check(R("ábreme Word") is { Mano: Mano.AbrirApp, Valor: "word" }, "abrir word");
Check(R("abre descargas") is { Mano: Mano.AbrirCarpeta, Valor: "descargas" }, "carpeta");
Check(R("open my documents") is { Mano: Mano.AbrirCarpeta, Valor: "documentos" }, "folder en");
Check(R("abre youtube") is { Mano: Mano.AbrirWeb, Valor: "https://www.youtube.com" }, "sitio");
Check(R("entra a sar.gob.hn") is { Mano: Mano.AbrirWeb, Valor: "https://sar.gob.hn" }, "dominio");
Check(R("busca el precio del café en Roatán") is { Mano: Mano.BuscarWeb, Valor: "el precio del café en Roatán" }, "buscar con tildes");
Check(R("search for flights to roatan") is { Mano: Mano.BuscarWeb, Valor: "flights to roatan" }, "search en");
Check(R("cállate") is { Mano: Mano.Callar }, "callar");
Check(R("ya cállate porfa") is { Mano: Mano.Callar }, "callar cortesia");
Check(R("pausa todo") is { Mano: Mano.Pausa }, "pausa");
Check(R("súbele al volumen") is { Mano: Mano.VolumenSubir }, "volumen");
Check(R("bájale un poco") is { Mano: Mano.VolumenBajar }, "bajar");
Check(R("siguiente canción") is { Mano: Mano.MultimediaSiguiente }, "siguiente");
Check(R("canción anterior") is { Mano: Mano.MultimediaAnterior }, "anterior");
Check(R("toma una captura de pantalla") is { Mano: Mano.Captura }, "captura");
Check(R("qué ves en mi pantalla") is { Mano: Mano.VerPantalla }, "ver pantalla");
Check(R("bloquea la compu") is { Mano: Mano.Bloquear, PideConfirmacion: true }, "bloquear confirma");
Check(R("cambia a claudio") is { Mano: Mano.Avatar, Valor: "claudio" }, "avatar");
Check(R("Claudio, pásame a la hormiga") is { Mano: Mano.Avatar, Valor: "antonio" }, "avatar ultimo nombre");
Check(R("no abras la calculadora").Mano == Mano.Ninguna, "negacion");
Check(R("¿cómo abro excel?").Mano == Mano.Ninguna, "pregunta no es orden");
Check(R("ayer abrí word y se trabó").Mano == Mano.Ninguna, "contar no es orden");
Check(R("hola aura, ¿cómo estás?").Mano == Mano.Ninguna, "charla");
Check(R("abre el chat") is { Mano: Mano.AbrirChat }, "abrir chat");
var rec = R("recuérdame en 10 minutos tomar la pastilla");
Check(rec.Mano == Mano.Recordar && rec.Cuando == TimeSpan.FromMinutes(10) && rec.Valor == "tomar la pastilla", $"recordatorio: {rec}");
Check(R("remind me in 2 hours to call my mom") is { Mano: Mano.Recordar } r2 && r2.Cuando == TimeSpan.FromHours(2) && r2.Valor == "call my mom", "reminder en");
Check(R("pon un temporizador de media hora") is { Mano: Mano.Recordar } r3 && r3.Cuando == TimeSpan.FromMinutes(30), "temporizador");
var tarde = new DateTime(2026, 9, 30, 14, 0, 0);
Check(Parametros.Tiempo("a las 5", tarde) == TimeSpan.FromHours(3), "a las 5 (tarde)");
Check(Parametros.Tiempo("a las 9 de la mañana", tarde) == TimeSpan.FromHours(19), "mañana");
Check(Parametros.Tiempo("a las 3 y media de la tarde", tarde) == TimeSpan.FromMinutes(90), "y media");
Check(Parametros.Tiempo("at 4:30 pm", tarde) == TimeSpan.FromMinutes(150), "at pm");
Check(Parametros.Tiempo("en cinco minutos", tarde) == TimeSpan.FromMinutes(5), "numero en letras");
Check(Parametros.TextoAEscribir("escribe en el bloc de notas: Hola, José") == "Hola, José", "escribir literal");
Check(Parametros.TextoAEscribir("escríbelo en word") == null, "escribelo = la ultima respuesta");
Check(Intencion.ConParametro(Mano.AbrirApp, "abre", "laya", 0.99).Mano == Mano.Ninguna, "sin parametro no se hace");
var dec = await Intencion.Decidir("redáctame una carta de renuncia", (_, _) => Task.FromResult<DecisionNodo?>(new DecisionNodo("win_redactar", 0.9, true)));
Check(dec.Mano == Mano.Redactar, $"decidir redactar: {dec}");
var nada = await Intencion.Decidir("¿quién ganó el mundial?", (_, _) => Task.FromResult<DecisionNodo?>(new DecisionNodo("win_ninguna", 0.99, false)));
Check(nada.Mano == Mano.Ninguna, "la charla va al cerebro");
var caido = await Intencion.Decidir("¿qué opinas de mi idea?", (_, _) => throw new HttpRequestException("caido"));
Check(caido.Mano == Mano.Ninguna, "nodo caido no rompe");

// ── SSE partido en cualquier byte ──
var sse = new LectorSse(); var eventos = new List<(string, string)>();
var flujo = "event: emocion\ndata: {\"emocion\":\"feliz\"}\n\nevent: delta\ndata: {\"voz\":\"Hola\"}\n\nevent: done\ndata: {}\n\n";
for (int i = 0; i < flujo.Length; i += 7) eventos.AddRange(sse.Leer(flujo.Substring(i, Math.Min(7, flujo.Length - i))));
Check(eventos.Count == 3 && eventos[0].Item1 == "emocion" && eventos[1].Item2 == "{\"voz\":\"Hola\"}", "sse");
Check(Expresiones.PelarEtiqueta("[EMO:feliz] Hola") == ("feliz", "Hola"), "etiqueta emocion");
Check(Expresiones.Quitar("Qué bueno [risa] verte") == "Qué bueno verte", "quitar expresiones");

// ── Frases para la voz: la primera sale pronto ──
var cf = new CortadorFrases(); var frases = new List<string>();
foreach (var t in new[] { "Hola, José. ", "Hoy tienes ", "tres pendientes importantes para la junta. Primero, ", "revisar el informe." }) frases.AddRange(cf.Agregar(t));
if (cf.Resto() is { } resto) frases.Add(resto);
Check(frases.Count == 3 && frases[0] == "Hola, José." && frases[^1] == "Primero, revisar el informe.", "cortador: " + string.Join(" | ", frases));

// ── Resorte: llega, rebota poco y se queda quieto ──
var res = new Resorte(0, 260, 25) { Objetivo = 100 }; double maximo = 0;
for (int i = 0; i < 120; i++) maximo = Math.Max(maximo, res.Paso(1 / 60.0));
Check(res.Quieto && res.Valor == 100 && maximo < 112, $"resorte (maximo {maximo:0.0})");
Check(AuraApi.Validar("https://aura-fp.onrender.com").AbsoluteUri == "https://aura-fp.onrender.com/", "servidor https");
Check(Throws(() => AuraApi.Validar("http://aura-fp.onrender.com")), "sin http remoto");
bool Throws(Action a) { try { a(); return false; } catch { return true; } }

// ── Auditoría: «sí» ambiguo nunca confirma ──
foreach (var f in new[] { "sí, pero mejor no", "claro que no", "yeah no, wait", "si no te importa, no", "no", "cancela", "espera" })
    Check(Parametros.Respuesta(f) == false, "no confirma: " + f);
foreach (var f in new[] { "sí", "Sí, dale", "claro", "vale", "ok", "yes please", "hazlo" })
    Check(Parametros.Respuesta(f) == true, "confirma: " + f);
Check(Parametros.Respuesta("¿qué hora es?") == null, "otra cosa no es respuesta");
// ── Auditoría: conversación que no es orden ──
foreach (var f in new[] { "vamos a hablar de política", "show me how to cook rice", "go to sleep", "pon atención", "prende la tele", "run me through it",
    "start with the basics", "get me a coffee", "load the dishwasher", "lanza una moneda", "la canción anterior era mejor",
    "mi jefe me pidió una captura de pantalla del error", "tengo un recordatorio a las 3 que no recuerdo" })
    Check(R(f).Mano == Mano.Ninguna, "no es orden: " + f + " → " + R(f));
Check(R("pon spotify") is { Mano: Mano.AbrirApp, Valor: "spotify" }, "verbo ambiguo con app conocida");
Check(R("ve a descargas") is { Mano: Mano.AbrirCarpeta }, "verbo ambiguo con carpeta");
Check(R("no me dejes olvidar pagar la luz en 20 minutos") is { Mano: Mano.Recordar } nd && nd.Cuando == TimeSpan.FromMinutes(20), "no me dejes olvidar");
var mediodia = new DateTime(2026, 9, 30, 13, 0, 0);
Check(Parametros.Tiempo("a las 12 de la noche", mediodia) == TimeSpan.FromHours(11), "medianoche");
Check(Parametros.Tiempo("a la una de la noche", mediodia) == TimeSpan.FromHours(12), "madrugada");
Check(Parametros.Tiempo("la reunion de dos horas a las 5", mediodia) == TimeSpan.FromHours(4), "hora explicita manda");
Check(Parametros.TextoAEscribir("escribe lo que te dije") == null, "escribe lo que te dije = la respuesta");
Check(Parametros.TextoAEscribir("escribe a las 10:30 la reunión") == "a las 10:30 la reunión", "dos puntos de la hora");

// ── Manos nativas 1.1 ──
Check(R("dale a Guardar") is { Mano: Mano.Pulsar, Valor: "Guardar" }, "pulsar");
Check(R("abre la pestaña Insertar") is { Mano: Mano.Pulsar, Valor: "Insertar" }, "pestaña");
Check(R("haz clic en el botón Aceptar") is { Mano: Mano.Pulsar, Valor: "Aceptar" }, "clic boton");
Check(R("click the Save button") is { Mano: Mano.Pulsar } pz && pz.Valor.Equals("save", StringComparison.OrdinalIgnoreCase), "click en");
Check(R("qué botones hay") is { Mano: Mano.QueHay }, "que hay");
Check(R("cierra esta ventana") is { Mano: Mano.Ventana, Valor: "cerrar|", PideConfirmacion: true }, "cerrar ventana confirma");
Check(R("cierra word") is { Mano: Mano.Ventana, Valor: "cerrar|word" }, "cerrar app");
Check(R("minimiza esta ventana") is { Mano: Mano.Ventana, Valor: "minimizar|" }, "minimizar");
Check(R("cambia a chrome") is { Mano: Mano.Ventana, Valor: "cambiar|chrome", PideConfirmacion: false }, "cambiar ventana");
Check(R("cambia a claudio") is { Mano: Mano.Avatar, Valor: "claudio" }, "cambiar a avatar sigue siendo avatar");
Check(R("cierra el chat") is { Mano: Mano.Ocultar } || R("cierra el chat").Mano != Mano.Ventana, "cerrar chat no es ventana");
Check(R("minimiza todo") is { Mano: Mano.Escritorio }, "minimiza todo = escritorio");
Check(R("¿qué hora es?") is { Mano: Mano.Info, Valor: "hora" }, "hora nativa");
Check(R("cuánta batería me queda") is { Mano: Mano.Info, Valor: "bateria" }, "bateria");
Check(R("how much disk space is left") is { Mano: Mano.Info, Valor: "disco" }, "disco");
Check(R("tengo internet?") is { Mano: Mano.Info, Valor: "red" }, "red");
Check(R("mi batería del carro está mala").Mano == Mano.Ninguna, "bateria del carro no");
Check(R("qué hora es en Madrid").Mano == Mano.Ninguna, "hora de otro lugar al cerebro");
Check(R("resume lo que copié") is { Mano: Mano.Portapapeles }, "portapapeles");
Check(R("abre el último archivo que descargué") is { Mano: Mano.AbrirArchivo, Valor: "ultimo-descargado" }, "ultima descarga");
Check(R("abre el archivo del contrato") is { Mano: Mano.AbrirArchivo, Valor: "contrato" }, "archivo por nombre");
Check(R("dale play").Mano == Mano.MultimediaPausa && R("dale a play").Mano == Mano.MultimediaPausa, "dale play es musica");

// ── 1.2: música, correo, agenda ──
Check(R("qué está sonando") is { Mano: Mano.Musica, Valor: "que-suena" }, "que suena");
Check(R("¿quién canta esta canción?") is { Mano: Mano.Musica, Valor: "que-suena" }, "quien canta");
Check(R("pon Bad Bunny en Spotify") is { Mano: Mano.Musica, Valor: "spotify|Bad Bunny" }, "spotify");
Check(R("ponme música de Marc Anthony en YouTube Music") is { Mano: Mano.Musica, Valor: "ytmusic|Marc Anthony" }, "yt music");
Check(R("play some jazz on spotify") is { Mano: Mano.Musica, Valor: "spotify|jazz" }, "play on spotify");
Check(R("reproduce la canción Despacito") is { Mano: Mano.Musica, Valor: "buscar|Despacito" }, "reproduce cancion");
Check(R("pon atención").Mano == Mano.Ninguna, "pon atencion sigue sin ser orden");
Check(R("léeme mis correos") is { Mano: Mano.Correo, Valor: "leer" }, "leer correos");
Check(R("¿tengo correos nuevos?") is { Mano: Mano.Correo, Valor: "contar" }, "contar correos");
Check(R("resume mis correos") is { Mano: Mano.Correo, Valor: "resumir" }, "resumir correos");
Check(R("check my email") is { Mano: Mano.Correo }, "check email");
Check(R("recuérdame revisar el correo en 20 minutos") is { Mano: Mano.Recordar }, "recordar revisar correo no es correo");
Check(R("¿qué tengo hoy?") is { Mano: Mano.Agenda, Valor: "hoy" }, "agenda hoy");
Check(R("qué tengo mañana") is { Mano: Mano.Agenda, Valor: "manana" }, "agenda manana");
Check(R("cuál es mi próxima reunión") is { Mano: Mano.Agenda, Valor: "proximo" }, "proxima reunion");
Check(R("tengo una reunión mañana").Mano == Mano.Ninguna, "contar una reunion no es agenda");
// iCal: zona, UTC, todo el día, repeticiones, exclusiones
var utc = TimeZoneInfo.Utc;
var ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Junta directiva\r\nLOCATION:Sala 2\r\nDTSTART:20261001T150000Z\r\nDTEND:20261001T160000Z\r\nEND:VEVENT\r\n"
        + "BEGIN:VEVENT\r\nSUMMARY:Cumpleaños de\r\n  Karla\r\nDTSTART;VALUE=DATE:20261002\r\nEND:VEVENT\r\n"
        + "BEGIN:VEVENT\r\nSUMMARY:Standup\r\nDTSTART:20260928T140000Z\r\nDURATION:PT15M\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6\r\nEXDATE:20260930T140000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
var evs = Ical.Eventos(ics, new DateTime(2026, 9, 28), new DateTime(2026, 10, 12), utc);
Check(evs.Any(e => e.Titulo == "Junta directiva" && e.Inicio == new DateTime(2026, 10, 1, 15, 0, 0) && e.Lugar == "Sala 2"), "ical utc");
Check(evs.Any(e => e.Titulo == "Cumpleaños de Karla" && e.TodoElDia), "ical todo el dia y linea doblada");
var standups = evs.Where(e => e.Titulo == "Standup").Select(e => e.Inicio.Day).ToArray();
Check(standups.SequenceEqual(new[] { 28, 2, 5, 7, 9 }), "ical semanal con exclusion y count: " + string.Join(",", standups));
Check(evs.First(e => e.Titulo == "Standup").Fin - evs.First(e => e.Titulo == "Standup").Inicio == TimeSpan.FromMinutes(15), "ical duracion");

// La ligera nunca cambia de avatar, captura, bloquea… por su cuenta (sin reglas ni nodo).
foreach (var f in new[] { "quién es mejor, claudio o antonio", "cómo se hace una captura de pantalla en windows", "ayer me dijiste que bloqueara la compu" })
{
    var d = await Intencion.Decidir(f, null);
    Check(!Intencion.SoloReglasONodo.Contains(d.Mano), "ligera no decide sola: " + f + " → " + d);
}
Console.WriteLine($"PASS {count} assertions");
class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
