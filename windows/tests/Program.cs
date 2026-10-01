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
Check(R("cierra esta ventana") is { Mano: Mano.Ventana, Valor: "cerrar|", PideConfirmacion: false }, "cerrar una ventana va de una");
Check(R("ciérrala") is { Mano: Mano.Ventana, Valor: "cerrar|" } && R("cierra chrome") is { Valor: "cerrar|chrome", PideConfirmacion: false } && R("cierra todo") is { PideConfirmacion: true }, "ciérrala y cerrar todo confirma");
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
// ── Música por voz: pausa, siguiente y anterior dichas como se dicen ──
foreach (var f in new[] { "pausa la música", "pon pausa", "para la música", "detén la música", "quita la música", "ya para la música por favor", "pause the music", "stop the music" })
    Check(R(f) is { Mano: Mano.MultimediaPausa, Valor: "pausar" }, "pausar música: " + f + " → " + R(f));
foreach (var f in new[] { "dale play", "reanuda la música", "sigue la música", "continúa la canción", "sigue con la canción", "resume the music", "play" })
    Check(R(f) is { Mano: Mano.MultimediaPausa, Valor: "reanudar" }, "reanudar música: " + f + " → " + R(f));
foreach (var f in new[] { "siguiente canción", "next song", "pasa a la siguiente", "pon la que sigue", "otra canción", "skip" })
    Check(R(f).Mano == Mano.MultimediaSiguiente, "siguiente: " + f + " → " + R(f));
foreach (var f in new[] { "la anterior", "regresa la canción", "regrésala", "la de antes", "pon la de antes", "otra vez la anterior", "vuelve a la anterior", "canción anterior", "previous", "previous song" })
    Check(R(f).Mano == Mano.MultimediaAnterior, "anterior: " + f + " → " + R(f));
// «para» o «detente» solos son para AURA, nunca para la canción; ni hablar de la canción anterior la regresa.
foreach (var f in new[] { "para", "detente", "para de hablar", "la canción anterior era mejor", "la de antes me gustaba más" })
    Check(R(f).Mano is not (Mano.MultimediaPausa or Mano.MultimediaAnterior or Mano.MultimediaSiguiente), "no es la música: " + f + " → " + R(f));
Check(R("para de hablar").Mano == Mano.Callar && R("para todo").Mano == Mano.Pausa, "para de hablar calla; para todo pausa");

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
Check(R("busca recetas de pupusas en youtube").Mano != Mano.Musica, "busca en youtube es web, no musica: " + R("busca recetas de pupusas en youtube"));
Check(R("busca Shakira en Spotify") is { Mano: Mano.Musica, Valor: "spotify|Shakira" }, "busca en spotify si es musica");
Check(R("pon a Shakira en Spotify") is { Mano: Mano.Musica, Valor: "spotify|Shakira" }, "pon a shakira: " + R("pon a Shakira en Spotify"));
Check(R("lee el correo de Juan") is { Mano: Mano.Correo, Valor: "de|juan" }, "correo de juan: " + R("lee el correo de Juan"));
Check(R("¿tengo correos de Amazon?") is { Mano: Mano.Correo, Valor: "de|amazon" }, "correos de amazon: " + R("¿tengo correos de Amazon?"));
Check(R("qué tengo hoy en la agenda") is { Mano: Mano.Agenda, Valor: "hoy" }, "hoy en la agenda");
Check(R("qué tengo en mi calendario mañana") is { Mano: Mano.Agenda, Valor: "manana" }, "calendario manana");
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
Check(evs.Where(e => e.Titulo == "Standup").All(e => e.Inicio.TimeOfDay == new TimeSpan(14, 0, 0)), "ical semanal conserva la hora (no la suma dos veces)");
// Alarmas dentro del evento, mensual día 31 y «2.º martes», serie vieja, cancelados y movidos, BYDAY vacío, zona con cambio de horario
var ics2 = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Dentista\r\nDTSTART:20261005T160000Z\r\nDTEND:20261005T170000Z\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nDESCRIPTION:Alarma\r\nSUMMARY:No soy el evento\r\nEND:VALARM\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:b\r\nSUMMARY:Pago\r\nDTSTART:20260131T090000Z\r\nRRULE:FREQ=MONTHLY\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:c\r\nSUMMARY:Comite\r\nDTSTART:20260113T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=2TU\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Diaria vieja\r\nDTSTART:20150101T080000Z\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:e\r\nSUMMARY:Cancelada\r\nSTATUS:CANCELLED\r\nDTSTART:20261006T100000Z\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:f\r\nSUMMARY:Clase\r\nDTSTART:20260929T120000Z\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:f\r\nRECURRENCE-ID:20261006T120000Z\r\nSUMMARY:Clase movida\r\nDTSTART:20261007T180000Z\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:g\r\nSUMMARY:Rara\r\nDTSTART:20261001T100000Z\r\nRRULE:FREQ=WEEKLY;BYDAY=\r\nEND:VEVENT\r\n"
    + "BEGIN:VEVENT\r\nUID:h\r\nSUMMARY:NY\r\nDTSTART;TZID=America/New_York:20261026T090000\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
var evs2 = Ical.Eventos(ics2, new DateTime(2026, 9, 28), new DateTime(2026, 11, 12), utc);
Check(evs2.Count(e => e.Titulo == "Dentista") == 1 && !evs2.Any(e => e.Titulo == "No soy el evento"), "ical valarm no pisa el evento");
Check(evs2.Where(e => e.Titulo == "Pago").Select(e => e.Inicio.Day).SequenceEqual(new[] { 31 }), "ical mensual dia 31 no deriva: " + string.Join(",", evs2.Where(e => e.Titulo == "Pago").Select(e => e.Inicio.ToString("MM-dd"))));
Check(evs2.Where(e => e.Titulo == "Comite").Select(e => e.Inicio.ToString("MM-dd")).SequenceEqual(new[] { "10-13", "11-10" }), "ical segundo martes: " + string.Join(",", evs2.Where(e => e.Titulo == "Comite").Select(e => e.Inicio.ToString("MM-dd"))));
Check(evs2.Count(e => e.Titulo == "Diaria vieja") >= 40, "ical serie diaria desde 2015 sigue apareciendo: " + evs2.Count(e => e.Titulo == "Diaria vieja"));
Check(!evs2.Any(e => e.Titulo == "Cancelada"), "ical cancelado no aparece");
Check(evs2.Where(e => e.Titulo.StartsWith("Clase")).Select(e => e.Titulo + e.Inicio.ToString("MM-dd")).SequenceEqual(new[] { "Clase09-29", "Clase movida10-07", "Clase10-13" }), "ical ocurrencia movida: " + string.Join(",", evs2.Where(e => e.Titulo.StartsWith("Clase")).Select(e => e.Titulo + e.Inicio.ToString("MM-dd"))));
Check(evs2.Any(e => e.Titulo == "Dentista"), "ical BYDAY vacio no tumba el resto");
Check(evs2.Where(e => e.Titulo == "NY").Select(e => e.Inicio.Hour).SequenceEqual(new[] { 13, 14 }), "ical zona con cambio de horario: " + string.Join(",", evs2.Where(e => e.Titulo == "NY").Select(e => e.Inicio.ToString("MM-dd HH"))));
Check(Ical.Eventos("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:x\r\nDTSTART:20261001T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=TU\r\nEND:VEVENT\r\nEND:VCALENDAR", new DateTime(2026, 9, 28), new DateTime(2026, 10, 30), utc) is { Count: 0 }, "ical regla no soportada no inventa fechas");
Check(evs.First(e => e.Titulo == "Standup").Fin - evs.First(e => e.Titulo == "Standup").Inicio == TimeSpan.FromMinutes(15), "ical duracion");

// OAuth con PKCE y lectores de Gmail, Google Calendar, YouTube, Graph y Spotify
var (verif, reto) = Oauth.Pkce();
Check(verif.Length >= 43 && reto.Length == 43 && !reto.Contains('=') && !reto.Contains('+'), "pkce base64url");
Check(Convert.ToBase64String(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.ASCII.GetBytes("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))).TrimEnd('=').Replace('+', '-').Replace('/', '_') == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "pkce vector del RFC 7636");
var gcfg = Oauth.Google("id-google", "secreto");
var urlA = Oauth.UrlAutorizar(gcfg, reto, "est123");
Check(urlA.StartsWith("https://accounts.google.com/o/oauth2/v2/auth?") && urlA.Contains("code_challenge_method=S256") && urlA.Contains("access_type=offline")
      && urlA.Contains("redirect_uri=" + Uri.EscapeDataString("http://127.0.0.1:43821/callback")) && urlA.Contains("gmail.readonly"), "url google");
Check(Oauth.Canje(gcfg, "c0d", verif)["client_secret"] == "secreto" && !Oauth.Canje(Oauth.Spotify("s"), "c", verif).ContainsKey("client_secret"), "canje con y sin secreto");
Check(Oauth.Renovacion(Oauth.Microsoft("m"), "r")["scope"].Contains("Mail.Read"), "microsoft renueva con alcances");
Check(Oauth.CodigoDe("/callback?code=abc%2F1&state=est123", "est123") == "abc/1", "codigo del callback");
Check(Throws(() => Oauth.CodigoDe("/callback?code=abc&state=otro", "est123")), "estado distinto se rechaza");
Check(Throws(() => Oauth.CodigoDe("/callback?error=access_denied&state=est123", "est123")), "cancelado");
var ahora0 = new DateTimeOffset(2026, 9, 30, 12, 0, 0, TimeSpan.Zero);
var tk = Oauth.LeerToken("{\"access_token\":\"A1\",\"refresh_token\":\"R1\",\"expires_in\":3600}", null, ahora0);
Check(tk.Acceso == "A1" && tk.Renovar == "R1" && tk.Vence == ahora0.AddHours(1) && !tk.Vencido(ahora0) && tk.Vencido(ahora0.AddMinutes(59.5)), "token leido");
var tk2 = Oauth.LeerToken("{\"access_token\":\"A2\",\"expires_in\":3600}", tk with { Cuenta = "yo@x.com" }, ahora0);
Check(tk2.Renovar == "R1" && tk2.Cuenta == "yo@x.com", "renovar conserva refresh y cuenta");
Check(Throws(() => Oauth.LeerToken("{\"error\":\"invalid_grant\"}", tk, ahora0)), "invalid_grant es error");
Check(LectorApis.Remitente("\"Karla Pérez\" <karla@x.com>") == "Karla Pérez" && LectorApis.Remitente("<a@b.com>") == "a@b.com" && LectorApis.Remitente("a@b.com") == "a@b.com", "remitente");
Check(LectorApis.GmailIds("{\"messages\":[{\"id\":\"m1\"},{\"id\":\"m2\"}]}").SequenceEqual(new[] { "m1", "m2" }) && LectorApis.GmailIds("{\"resultSizeEstimate\":0}").Count == 0, "gmail ids");
var gm = LectorApis.GmailMensaje("{\"id\":\"m1\",\"internalDate\":\"1790000000000\",\"snippet\":\"La junta se movi&oacute; al jueves\",\"payload\":{\"headers\":[{\"name\":\"From\",\"value\":\"Karla <k@x.com>\"},{\"name\":\"Subject\",\"value\":\"Junta\"}]}}");
Check(gm is { Id: "m1", De: "Karla", Asunto: "Junta" } && gm.Resumen == "La junta se movió al jueves", "gmail mensaje: " + gm);
var gr = LectorApis.GraphCorreos("{\"value\":[{\"id\":\"g1\",\"subject\":\"\",\"bodyPreview\":\"hola \",\"receivedDateTime\":\"2026-09-30T15:00:00Z\",\"from\":{\"emailAddress\":{\"name\":\"\",\"address\":\"jefe@x.com\"}}}]}");
Check(gr.Count == 1 && gr[0].De == "jefe@x.com" && gr[0].Asunto == "(sin asunto)" && gr[0].Resumen == "hola", "graph correos");
var gev = LectorApis.GoogleEventos("{\"items\":[{\"summary\":\"Junta\",\"location\":\"Sala 2\",\"start\":{\"dateTime\":\"2026-10-01T09:00:00-06:00\"},\"end\":{\"dateTime\":\"2026-10-01T10:00:00-06:00\"}},{\"summary\":\"Feriado\",\"start\":{\"date\":\"2026-10-03\"},\"end\":{\"date\":\"2026-10-04\"}},{\"status\":\"cancelled\",\"summary\":\"x\",\"start\":{\"date\":\"2026-10-02\"}}]}", utc);
Check(gev.Count == 2 && gev[0].Inicio == new DateTime(2026, 10, 1, 15, 0, 0) && gev[0].Lugar == "Sala 2" && gev[1].TodoElDia, "google calendar");
var mev = LectorApis.GraphEventos("{\"value\":[{\"subject\":\"Cliente\",\"isAllDay\":false,\"start\":{\"dateTime\":\"2026-10-01T16:30:00.0000000\",\"timeZone\":\"UTC\"},\"end\":{\"dateTime\":\"2026-10-01T17:00:00.0000000\"},\"location\":{\"displayName\":\"Teams\"}},{\"subject\":\"x\",\"isCancelled\":true,\"start\":{\"dateTime\":\"2026-10-01T10:00:00\"}}]}", utc);
Check(mev.Count == 1 && mev[0].Inicio == new DateTime(2026, 10, 1, 16, 30, 0) && mev[0].Lugar == "Teams", "graph calendario");
var busq = "{\"artists\":{\"items\":[{\"name\":\"Bad Bunny\",\"uri\":\"spotify:artist:1\"}]},\"tracks\":{\"items\":[{\"name\":\"Tití Me Preguntó\",\"uri\":\"spotify:track:9\",\"artists\":[{\"name\":\"Bad Bunny\"}]}]},\"playlists\":{\"items\":[null,{\"name\":\"This Is Bad Bunny\",\"uri\":\"spotify:playlist:5\"}]}}";
Check(LectorApis.SpotifyElegir(busq, "Bad Bunny") is { Uri: "spotify:artist:1", Contexto: true }, "spotify artista");
Check(LectorApis.SpotifyElegir(busq, "titi me pregunto") is { Uri: "spotify:track:9", Contexto: false, Descripcion: "Tití Me Preguntó, de Bad Bunny" }, "spotify cancion");
Check(LectorApis.SpotifyElegir(busq, "una playlist de bad bunny") is { Uri: "spotify:playlist:5" }, "spotify playlist (salta nulos)");
Check(LectorApis.SpotifyElegir("{\"tracks\":{\"items\":[]}}", "x") is null, "spotify sin resultados");
Check(LectorApis.SpotifyDispositivos("{\"devices\":[{\"id\":\"d1\",\"name\":\"PC\",\"is_active\":false},{\"id\":\"d2\",\"name\":\"TV\",\"is_restricted\":true}]}").Count == 1, "spotify dispositivos");
Check(LectorApis.SpotifyMotivo("{\"error\":{\"status\":404,\"reason\":\"NO_ACTIVE_DEVICE\"}}") == "NO_ACTIVE_DEVICE" && LectorApis.SpotifyMotivo("no json") == "", "spotify motivo");
Check(LectorApis.YoutubePrimero("{\"items\":[{\"id\":{\"kind\":\"youtube#channel\"}},{\"id\":{\"videoId\":\"v1\"},\"snippet\":{\"title\":\"Vivir Mi Vida &amp; m&aacute;s\"}}]}") is { Id: "v1", Titulo: "Vivir Mi Vida & más" }, "youtube primero");
Check(LectorApis.Cuenta("{\"sub\":\"1\",\"email\":\"yo@gmail.com\"}") == "yo@gmail.com" && LectorApis.Cuenta("{\"userPrincipalName\":\"a@outlook.com\",\"mail\":null}") == "a@outlook.com", "cuenta");

// Notificaciones de otras apps: el toast de Windows → app, título, cuerpo, sitio
var toastWa = "<toast launch=\"x\"><visual><binding template=\"ToastGeneric\"><text>Karla</text><text>¿Vienes a la junta?</text><text>Traigo el informe</text></binding></visual></toast>";
var av = AvisosApps.Leer(7, "5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App", toastWa, 134036928000000000);
Check(av is { Id: 7, App: "WhatsApp", Titulo: "Karla", Cuerpo: "¿Vienes a la junta? · Traigo el informe", Sitio: "" }, "toast whatsapp: " + av);
var toastWeb = "﻿<toast><visual><binding template=\"ToastGeneric\"><text>Nuevo mensaje</text><text>Hola</text><text placement=\"attribution\">web.whatsapp.com</text></binding><binding template=\"ToastText02\"><text>otro</text></binding></visual></toast>\0";
Check(AvisosApps.Leer(8, "Chrome", toastWeb, 0) is { App: "Chrome", Titulo: "Nuevo mensaje", Cuerpo: "Hola", Sitio: "web.whatsapp.com" }, "toast web con sitio y BOM");
Check(AvisosApps.Leer(9, "x", "<toast><visual><binding template=\"ToastGeneric\"><image src=\"a.png\"/></binding></visual></toast>", 0) is null, "toast sin texto");
Check(AvisosApps.Leer(9, "x", "<tile><visual/></tile>", 0) is null && AvisosApps.Leer(9, "x", "no es xml <", 0) is null, "no toast / xml roto");
Check(AvisosApps.NombreApp("Microsoft.Office.OUTLOOK.EXE.15") == "Outlook" && AvisosApps.NombreApp("MSTeams_8wekyb3d8bbwe!MSTeams") == "Teams"
      && AvisosApps.NombreApp("Contoso.Ventas_abc123def!App") == "Ventas" && AvisosApps.NombreApp("{6D809377-6AF0-444B-8957-A3773F02200E}\\Foo\\bar.exe") == "Bar", "nombres de app: " + AvisosApps.NombreApp("{6D809377-6AF0-444B-8957-A3773F02200E}\\Foo\\bar.exe"));
Check(AvisosApps.EsPropia("Aura.Windows") && !AvisosApps.EsPropia("Chrome"), "aura no se avisa a si misma");
Check(R("¿qué notificaciones tengo?") is { Mano: Mano.Notificaciones, Valor: "leer" }, "que notificaciones");
Check(R("léeme la última notificación") is { Mano: Mano.Notificaciones, Valor: "ultima" }, "ultima notificacion");
Check(R("qué me llegó") is { Mano: Mano.Notificaciones, Valor: "leer" }, "que me llego");
Check(R("silencia las notificaciones de WhatsApp") is { Mano: Mano.Notificaciones, Valor: "silenciar|whatsapp" }, "silenciar app");
Check(R("vuelve a mostrar las notificaciones de WhatsApp") is { Mano: Mano.Notificaciones, Valor: "activar|whatsapp" }, "activar app");
Check(R("read my notifications") is { Mano: Mano.Notificaciones, Valor: "leer" } && R("mute Slack notifications") is { Valor: "silenciar|slack" }, "notificaciones en ingles: " + R("mute Slack notifications"));
Check(R("me llegó algún correo") is { Mano: Mano.Correo }, "correo sigue siendo correo");

// Genesis ID como la app: reto, URL de la wallet y la vuelta ultronfp://sso
var (verG, retoG, estG) = GenesisSso.Nuevo();
Check(verG.Length == 43 && retoG == GenesisSso.Reto(verG) && estG.Length == 16, "genesis reto");
Check(GenesisSso.Reto("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "genesis reto = sha256 ascii (como la app)");
Check(GenesisSso.Url(null, "R+/", "E") == "https://app.vetawallet.com/#sso-aura?reto=R%2B%2F&estado=E" && GenesisSso.Url("http://malo", "r", "e").StartsWith("https://app.vetawallet.com/"), "genesis url");
Check(GenesisSso.LeerVuelta("ultronfp://sso?pase=abc%2Bd&estado=E1") is { Pase: "abc+d", Estado: "E1", Error: null }, "vuelta con pase");
Check(GenesisSso.LeerVuelta("\"ultronfp://sso/?error=cancelado&estado=E2\"") is { Error: "cancelado", Estado: "E2" }, "vuelta con error y comillas");
Check(GenesisSso.LeerVuelta("https://aura-fp.onrender.com/sso?pase=p&estado=e") is { Pase: "p" }, "vuelta https");
Check(GenesisSso.LeerVuelta("ultronfp://ssoXYZ?pase=p") is null && GenesisSso.LeerVuelta("https://aura-fp.onrender.com.malo/sso?pase=p") is null && GenesisSso.LeerVuelta("http://x") is null, "vueltas falsas");
Check(GenesisSso.LeerVuelta("ultronfp://sso?pase=%E0%A4%A&estado=e") is { Estado: "e" }, "vuelta con % roto no lanza");

// Cartera Veta Wallet (solo lectura): saldos de la cadena 5550 como los lee la wallet
Check(CarteraVeta.EsDireccion("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B") && !CarteraVeta.EsDireccion("0x123") && !CarteraVeta.EsDireccion("6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B"), "direccion valida");
Check(CarteraVeta.DatosBalanceOf("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B") == "0x70a08231" + "0000000000000000000000006facc8df79cedc6c5065442ce27e915aa3a26b9b", "balanceOf");
Check(CarteraVeta.Cantidad("0x1bc16d674ec80000") == 2m && CarteraVeta.Cantidad("0x0") == 0 && CarteraVeta.Cantidad("0x") == 0 && CarteraVeta.Cantidad("0xzz") == 0 && CarteraVeta.Cantidad(null) == 0, "cantidad 18 decimales");
Check(CarteraVeta.Cantidad("0x" + new string('0', 63) + "1") == 0.000000000000000001m, "cantidad minima");
Check(CarteraVeta.Precio("ORIGEN", 3110.35m, 30m) == 3110.35m / 31.1035m / 55m && CarteraVeta.Precio("AGKA", 3110m, 30m) == 30m && CarteraVeta.Precio("ONDK", 3110m, 30m) == null && CarteraVeta.Precio("LOVE", null, null) == 0.1m, "precios");
var loteJson = CarteraVeta.ArmarLote("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B");
Check(loteJson.Contains("\"eth_getBalance\"") && loteJson.Contains("\"eth_call\"") && loteJson.Contains("\"id\":14"), "lote rpc");
var hexes = CarteraVeta.LeerLote("[{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":\"0x3635c9adc5dea00000\"},{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"0x1bc16d674ec80000\"},{\"jsonrpc\":\"2.0\",\"id\":2,\"error\":{\"code\":-32000}}]");
var saldosCartera = CarteraVeta.Saldos(hexes, 3110.35m, 30m);
Check(saldosCartera[0] is { Simbolo: "ORIGEN", Cantidad: 1000m } && saldosCartera[1].Cantidad == 2m && saldosCartera[2].Cantidad == 0 && saldosCartera[1].ValorUsd == 6220.70m, "saldos: " + saldosCartera[0] + " " + saldosCartera[1]);
Check(CarteraVeta.Decir(saldosCartera, "origen", false).StartsWith("Tienes 1,000 ORIGEN (unos 1,818"), "decir origen: " + CarteraVeta.Decir(saldosCartera, "origen", false));
Check(CarteraVeta.Decir(saldosCartera, null, false).StartsWith("Tienes unos 8,038.7 dólares: 2 AUKA, 1,000 ORIGEN") || CarteraVeta.Decir(saldosCartera, null, false).StartsWith("Tienes unos 8,039 dólares"), "decir todo: " + CarteraVeta.Decir(saldosCartera, null, false));
Check(CarteraVeta.Decir(new List<Saldo>(), null, true) == "Your wallet is empty.", "cartera vacia");
static bool Lanza(Action f) { try { f(); return false; } catch { return true; } }
// Enviar por PULSE2CHAT: AURA prepara el enlace de Veta Wallet (#pagar) y mira la cadena; nunca firma.
Check(CarteraVeta.Monto("10") == 10m && CarteraVeta.Monto("2.5") == 2.5m && CarteraVeta.Monto("2,5") == 2.5m && CarteraVeta.Monto("1,000") == 1000m && CarteraVeta.Monto("1,000.25") == 1000.25m, "monto escrito");
Check(CarteraVeta.Monto("0") == null && CarteraVeta.Monto("-3") == null && CarteraVeta.Monto("abc") == null && CarteraVeta.Monto("1.2.3") == null && CarteraVeta.Monto("") == null, "monto invalido");
Check(CarteraVeta.EnlacePagar("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B", 2.5m, "origen") == "https://app.vetawallet.com/#pagar?a=0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B&m=2.5&s=ORIGEN", "enlace pagar");
Check(Lanza(() => CarteraVeta.EnlacePagar("0x123", 1m, "ORIGEN")) && Lanza(() => CarteraVeta.EnlacePagar("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B", 1m, "BTC")) && Lanza(() => CarteraVeta.EnlacePagar("0x6Facc8Df79cEDc6C5065442ce27e915Aa3a26B9B", 0m, "ORIGEN")), "enlace pagar invalido");
Check(CarteraVeta.AWei(2m) == System.Numerics.BigInteger.Parse("2000000000000000000") && CarteraVeta.AWei(0.000000000000000001m) == 1 && CarteraVeta.AWei(1.5m) == System.Numerics.BigInteger.Parse("1500000000000000000"), "a wei");
{
    const string yoDir = "0x1111111111111111111111111111111111111111", suDir = "0x2222222222222222222222222222222222222222";
    var hashN = "0x" + new string('a', 64); var hashT = "0x" + new string('b', 64);
    var datosT = "0xa9059cbb" + suDir[2..].PadLeft(64, '0') + "1bc16d674ec80000".PadLeft(64, '0');
    var bloques = "[{\"id\":1,\"result\":{\"transactions\":[" +
        "{\"hash\":\"0x" + new string('c', 64) + "\",\"from\":\"" + yoDir + "\",\"to\":\"" + suDir + "\",\"value\":\"0x1\",\"input\":\"0x\"}," +
        "{\"hash\":\"" + hashN + "\",\"from\":\"" + yoDir.ToUpperInvariant().Replace("0X", "0x") + "\",\"to\":\"" + suDir + "\",\"value\":\"0x22b1c8c1227a0000\",\"input\":\"0x\"}]}}," +
        "{\"id\":2,\"result\":{\"transactions\":[{\"hash\":\"" + hashT + "\",\"from\":\"" + yoDir + "\",\"to\":\"0x6facc8df79cedc6c5065442ce27e915aa3a26b9b\",\"value\":\"0x0\",\"input\":\"" + datosT + "\"}]}}]";
    Check(CarteraVeta.BuscarEnvio(bloques, yoDir, suDir, "ORIGEN", 2.5m) == hashN, "envio nativo encontrado");
    Check(CarteraVeta.BuscarEnvio(bloques, yoDir, suDir, "AUKA", 2m) == hashT, "envio token encontrado");
    Check(CarteraVeta.BuscarEnvio(bloques, yoDir, suDir, "ORIGEN", 3m) == null && CarteraVeta.BuscarEnvio(bloques, suDir, yoDir, "ORIGEN", 2.5m) == null, "envio que no paso");
}
Check(Intencion.PorReglas("mándale 10 ORIGEN a Beto") is { Mano: Mano.Pulse, Valor: "pago|beto|10|ORIGEN" }, "voz pago: " + Intencion.PorReglas("mándale 10 ORIGEN a Beto").Valor);
Check(Intencion.PorReglas("envíale 2.5 auka a Karla López") is { Mano: Mano.Pulse, Valor: "pago|karla lopez|2.5|AUKA" }, "voz pago decimal: " + Intencion.PorReglas("envíale 2.5 auka a Karla López").Valor);
Check(Intencion.PorReglas("send 3 origen to Beto") is { Mano: Mano.Pulse, Valor: "pago|beto|3|ORIGEN" }, "voz pago en ingles");
Check(Intencion.PorReglas("pásale a Beto 1,000 origen") is { Mano: Mano.Pulse, Valor: "pago|beto|1000|ORIGEN" }, "voz pago al reves: " + Intencion.PorReglas("pásale a Beto 1,000 origen").Valor);
Check(Intencion.PorReglas("mándale a Beto que ya llegué").Valor.StartsWith("mensaje|beto|"), "mensaje sigue siendo mensaje");

Check(R("¿cuánto tengo?") is { Mano: Mano.Cartera, Valor: "todo" } && R("cuánto ORIGEN tengo") is { Mano: Mano.Cartera, Valor: "ORIGEN" } && R("cuántos orígenes tengo") is { Valor: "ORIGEN" }, "cartera por voz: " + R("cuántos orígenes tengo"));
Check(R("mi saldo de AUKA") is { Mano: Mano.Cartera, Valor: "AUKA" } && R("how much origen do I have") is { Valor: "ORIGEN" } && R("check my wallet") is { Mano: Mano.Cartera }, "cartera variantes");
Check(R("cuánto tengo que pagar de luz").Mano != Mano.Cartera && R("cuánto tiempo tengo").Mano != Mano.Cartera, "cartera no se confunde");

// Más control del equipo: atajos, Configuración de Windows, brillo y tema
Check(R("cópialo") is { Mano: Mano.Atajo, Valor: "teclas|CTRL+C" } && R("pega aquí") is { Valor: "teclas|CTRL+V" } && R("guarda el archivo") is { Valor: "teclas|CTRL+S" }, "atajos basicos");
Check(R("nueva pestaña") is { Valor: "teclas|CTRL+T" } && R("cierra la pestaña") is { Valor: "teclas|CTRL+W" } && R("pon la ventana a la izquierda") is { Valor: "teclas|WIN+LEFT" }, "atajos de pestañas y ventanas");
Check(R("presiona control shift s") is { Mano: Mano.Atajo, Valor: "teclas|CTRL+SHIFT+S" } && R("press alt + tab") is { Valor: "teclas|ALT+TAB" } && R("presiona f5") is { Valor: "teclas|F5" }, "presiona combo: " + R("presiona control shift s"));
Check(R("presiona alt f4").Mano != Mano.Atajo && R("presiona control alt suprimir").Mano != Mano.Atajo, "combos peligrosos no");
Check(R("abre la configuración de wifi") is { Mano: Mano.Atajo, Valor: "config|network-wifi" } && R("open bluetooth settings") is { Valor: "config|bluetooth" } && R("abre la configuración") is { Valor: "config|" }, "configuracion: " + R("open bluetooth settings"));
Check(R("sube el brillo") is { Valor: "brillo|+" } && R("baja el brillo") is { Valor: "brillo|-" } && R("pon el brillo al 70") is { Valor: "brillo|70" }, "brillo");
Check(R("activa el modo oscuro") is { Valor: "tema|oscuro" } && R("light mode") is { Valor: "tema|claro" }, "tema");
Check(R("baja") is { Mano: Mano.VolumenBajar } && R("sube el volumen") is { Mano: Mano.VolumenSubir } && R("baja la página") is { Valor: "teclas|PAGEDOWN" }, "volumen sigue siendo volumen");

var sonando = LectorApis.SpotifyEstado("{\"is_playing\":true,\"progress_ms\":61000,\"shuffle_state\":false,\"repeat_state\":\"off\",\"device\":{\"name\":\"MI-PC\",\"volume_percent\":70},\"item\":{\"uri\":\"spotify:track:9\",\"name\":\"Tití Me Preguntó\",\"duration_ms\":243000,\"artists\":[{\"name\":\"Bad Bunny\"}],\"album\":{\"name\":\"Un Verano Sin Ti\",\"images\":[{\"url\":\"https://i.scdn.co/a.jpg\"}]}}}");
Check(sonando is { Titulo: "Tití Me Preguntó", Artista: "Bad Bunny", Sonando: true, ProgresoMs: 61000, DuracionMs: 243000, Dispositivo: "MI-PC", Volumen: 70, Portada: "https://i.scdn.co/a.jpg" }, "spotify estado");
Check(LectorApis.SpotifyEstado("") is null && LectorApis.SpotifyEstado("{\"is_playing\":false,\"item\":null}") is null, "spotify sin nada");
var resultados = LectorApis.SpotifyResultados("{\"tracks\":{\"items\":[{\"uri\":\"spotify:track:1\",\"name\":\"A\",\"duration_ms\":1000,\"artists\":[{\"name\":\"X\"}],\"album\":{\"images\":[]}}]},\"artists\":{\"items\":[{\"uri\":\"spotify:artist:2\",\"name\":\"X\",\"images\":[{\"url\":\"u\"}]}]},\"playlists\":{\"items\":[null,{\"uri\":\"spotify:playlist:3\",\"name\":\"P\",\"owner\":{\"display_name\":\"Spotify\"},\"images\":[]}]}}");
Check(resultados.Select(x => x.Tipo + ":" + x.Titulo).SequenceEqual(new[] { "cancion:A", "artista:X", "playlist:P" }), "spotify resultados");

// PULSE2CHAT por voz
Check(R("llama a Karla") is { Mano: Mano.Pulse, Valor: "llamada|voz|karla" } && R("hazle una videollamada a Karla Pérez") is { Valor: "llamada|video|karla perez" } && R("call John") is { Valor: "llamada|voz|john" }, "llamar: " + R("hazle una videollamada a Karla Pérez"));
Check(R("mándale un mensaje a Karla que ya voy en camino") is { Mano: Mano.Pulse, Valor: "mensaje|karla|ya voy en camino" }, "mensaje: " + R("mándale un mensaje a Karla que ya voy en camino"));
Check(R("text John that I'm running late") is { Valor: "mensaje|john|I'm running late" }, "text en ingles: " + R("text John that I'm running late"));
Check(R("llama la atención").Mano != Mano.Pulse, "llamar la atencion no es llamada");

// «Oye AURA» en una sola frase y apagar el micrófono por voz
Check(Parametros.QuitarNombre("Oye AURA, abre el bloc de notas", out var resto1) && resto1 == "abre el bloc de notas", "oye aura + orden: " + resto1);
Check(Parametros.QuitarNombre("aura", out var resto2) && resto2 == "", "solo el nombre");
Check(Parametros.QuitarNombre("Hey Claudio what time is it", out var resto3) && resto3 == "what time is it", "hey claudio");
Check(!Parametros.QuitarNombre("la aurora boreal es bonita", out _) && !Parametros.QuitarNombre("mañana voy a Laura", out _), "no despierta con otra cosa");
Check(R("deja de escucharme") is { Mano: Mano.Dormir } && R("apágate") is { Mano: Mano.Dormir } && R("stop listening") is { Mano: Mano.Dormir } && R("silénciate") is { Mano: Mano.Dormir }, "dormir");
Check(R("cállate") is { Mano: Mano.Callar } && R("silencia la computadora") is { Mano: Mano.Silenciar }, "callar y mute siguen igual");

// Lo que el transcriptor inventa en el ruido y el eco de AURA no se atienden
Check(Fantasma.Es("¡Hasta la próxima!") && Fantasma.Es("Espera un momentito.") && Fantasma.Es("Gracias por ver el video") && Fantasma.Es("Subtítulos realizados por la comunidad de Amara.org"), "fantasmas del transcriptor");
Check(Fantasma.Es("claro que sí, te lo abro", "¡Claro que sí, te lo abro ahora mismo!"), "eco de lo que dijo AURA");
Check(!Fantasma.Es("abre el bloc de notas") && !Fantasma.Es("hasta qué hora abre el banco") && !Fantasma.Es("gracias, ahora pon música", null), "lo real sí pasa");

// Las manos que pide el cerebro: la marca no se ve ni se dice, aunque llegue partida
{
    var fa = new FiltroAcciones(); var hechas = new List<string>();
    var vis = fa.Agregar("Listo, la cierro. ⟦ha", o => hechas.Add(o)) + fa.Agregar("cer: cierra spo", o => hechas.Add(o)) + fa.Agregar("tify⟧ ¡ya!", o => hechas.Add(o));
    Check(vis == "Listo, la cierro.  ¡ya!" && hechas.Count == 1 && hechas[0] == "cierra spotify", "marca partida: " + vis + " / " + string.Join(",", hechas));
    Check(FiltroAcciones.Quitar("Va. ⟦hacer: pon bad bunny en spotify⟧") == "Va." && new FiltroAcciones().Agregar("⟦cualquier cosa⟧ hola") == " hola", "quitar marca y marca sin hacer");
    Check(R(new FiltroAcciones() is { } f2 && f2.Agregar("⟦hacer: cierra chrome⟧") == "" ? f2.Ordenes[0] : "") is { Mano: Mano.Ventana, Valor: "cerrar|chrome" }, "la orden del cerebro la ejecutan las reglas");
}

Check(R("escribe hola") is { Mano: Mano.Escribir, Valor: "hola" } && R("teclea: nos vemos mañana") is { Mano: Mano.Escribir }, "escribir directo: " + R("escribe hola"));
Check(R("escribe un correo a Juan sobre la junta").Mano != Mano.Escribir && R("write an email to my boss").Mano != Mano.Escribir, "redactar no es teclear");

// Revisión de Laya ligera con frases reales
Check(await Intencion.Decidir("pon bad bunny") is { Mano: Mano.Musica, Valor: "buscar|bad bunny" }, "pon bad bunny lo pone: " + await Intencion.Decidir("pon bad bunny"));
Check(R("pon música") is { Mano: Mano.Musica, Valor: "reanudar|" } && R("reproduce algo de música") is { Valor: "reanudar|" }, "pon música retoma");
Check(R("pausa") is { Mano: Mano.MultimediaPausa } && R("pausa todo") is { Mano: Mano.Pausa }, "pausa sola es la música; pausa todo es todo");
Check(await Intencion.Decidir("necesito la calculadora") is { Mano: Mano.AbrirApp, Valor: "calculadora" }, "necesito la calculadora: " + await Intencion.Decidir("necesito la calculadora"));
Check(R("activa el bluetooth") is { Mano: Mano.Atajo, Valor: "config|bluetooth" } && R("apaga el wifi") is { Valor: "config|network-wifi" }, "bluetooth y wifi");
Check(R("apaga la computadora") is { Mano: Mano.Atajo, Valor: "energia|apagar" } && R("reinicia la compu") is { Valor: "energia|reiniciar" } && R("cierra sesión") is { Valor: "energia|salir" }, "energía: " + R("cierra sesión"));
Check(R("apaga el micrófono") is { Mano: Mano.Dormir } && R("duerme").Mano != Mano.Atajo && R("apágate") is { Mano: Mano.Dormir }, "apagar el mic no apaga la PC");
Check(R("pon la alarma a las 7").Mano != Mano.Musica && R("pon el volumen al 50").Mano != Mano.Musica, "pon X que no es música");

// El cerebro no trae cosas que no dijiste
Check(!FiltroAcciones.Coherente("pon Queen Bohemian Rhapsody en spotify", "pon bachata en spotify"), "no cambia bachata por Queen");
Check(FiltroAcciones.Coherente("cierra spotify", "ciérrame eso de Spotify") && FiltroAcciones.Coherente("pon bad bunny en spotify", "ponme algo de Bad Bunny porfa") && FiltroAcciones.Coherente("cierra esta ventana", "quita esa ventana"), "ordenar lo tuyo sí");
Check(FiltroAcciones.Coherente("pon bachata en spotify", "pon bachatas en Spotify") && !FiltroAcciones.Coherente("abre excel", "abre el bloc de notas"), "plural sí, otra app no");

// El cerebro corrige lo que el micrófono entendió mal: eso sí sale de lo dicho (José: «hasta la segunda vez lo hace»).
Check(FiltroAcciones.Coherente("abre excel", "abre exel") && FiltroAcciones.Coherente("abre spotify", "abre spotifai"), "mal oído, misma app");
Check(!FiltroAcciones.Coherente("abre word", "abre excel") && !FiltroAcciones.Coherente("pon rock", "pon pop") && !FiltroAcciones.Coherente("abre teams", "abre steam"), "parecida no es cualquiera");
Check(FiltroAcciones.Parecidas("excel", "exel") && !FiltroAcciones.Parecidas("rock", "pop") && !FiltroAcciones.Parecidas("sol", "sal"), "parecidas");
// Música sin decir «en Spotify»: se hace aquí mismo, sin esperar al cerebro (José: «puse the verve…»).
foreach (var (f, q) in new[] { ("pon the verve", "the verve"), ("ponme bohemian rhapsody", "bohemian rhapsody"), ("quiero escuchar the verve", "the verve"), ("reprodúceme bitter sweet symphony", "bitter sweet symphony") })
    Check(R(f) is { Mano: Mano.Musica } pm && pm.Valor == "buscar|" + q, "música sin app: " + f + " → " + R(f));
foreach (var f in new[] { "pon la alarma a las 7", "pon el volumen al 50", "pon esto en word", "pon una película", "ponme el despertador", "quiero escuchar el correo", "pon a cargar el celular" })
    Check(R(f).Mano != Mano.Musica, "no es música: " + f + " → " + R(f));
// Abrir una app: cuenta una ventana DE esa app, no cualquiera nueva (Codex en #112).
Check(AppVentana.Es("Microsoft Excel", "Libro1 - Excel", "EXCEL") && AppVentana.Es("Word", "Documento1 - Word", "WINWORD") && AppVentana.Es("Spotify", "Spotify Premium", "Spotify"), "ventana de la app");
Check(AppVentana.Es("configuracion", "Configuración", "SystemSettings") && AppVentana.Es("Calculadora", "Calculadora", "ApplicationFrameHost"), "apps del sistema");
Check(!AppVentana.Es("Microsoft Excel", "Actualización de Windows", "explorer") && !AppVentana.Es("Word", "WhatsApp", "WhatsApp"), "otra ventana no es la app");
// La música: solo cuenta lo que nombra lo pedido (antes le daba play a lo de la búsqueda anterior).
Check(!MusicaPedida.Menciona("Reproducir Bohemian Rhapsody", "the verve") && MusicaPedida.Menciona("Reproducir Bitter Sweet Symphony de The Verve", "the verve"), "the verve no es bohemian");
Check(MusicaPedida.Menciona("Play Bohemian Rhapsody - Remastered 2011", "bohemian rhapsody de queen") && MusicaPedida.Menciona("Queen", "bohemian rhapsody de queen"), "lo pedido sí");
Check(MusicaPedida.Claves("pon una canción de The Verve en Spotify").SequenceEqual(new[] { "verve" }) && MusicaPedida.Menciona("lo que sea", "pon música"), "claves con sustancia; sin claves, no se puede saber");
// «Oye AURA» con el umbral más bajo, pero sostenido: un pico suelto (ruido) no despierta.
{
    var c = new ConfirmaPalabra();
    Check(!c.Alimentar(0.8f) && c.Alimentar(0.78f), "dos trozos seguidos sobre 0,75 despiertan");
    c.Reiniciar();
    Check(!c.Alimentar(0.8f) && !c.Alimentar(0.2f) && !c.Alimentar(0.76f), "un pico suelto no");
    Check(new ConfirmaPalabra().Alimentar(0.93f), "0,9 o más despierta de una (como antes)");
}
// Hacer y comprobar: se espera a VER el resultado, y si no se ve, otra vez.
{
    int n = 0;
    Check(await Verificar.Esperar(() => ++n >= 3, 2000, 10) && n == 3, "esperar hasta verlo");
    Check(!await Verificar.Esperar(() => false, 60, 10), "con tope, no espera para siempre");
    Check(!await Verificar.Esperar(() => throw new Exception("x"), 30, 10), "un error es «no se ve»");
    int intentos = 0;
    Check(await Verificar.Reintentar(async i => { intentos++; await Task.Yield(); return i == 2; }) == 2 && intentos == 2, "el segundo intento sale");
    Check(await Verificar.Reintentar(_ => Task.FromResult(false), 3) == 0, "si nunca sale, 0 (y se dice que no se pudo)");
}
{
    var habla = System.Text.Json.JsonDocument.Parse(AgenteProtocolo.AvisoPc("no se pudo — No encontré «exel» [x]", true)).RootElement;
    var calla = System.Text.Json.JsonDocument.Parse(AgenteProtocolo.AvisoPc("hecho — Abriendo Excel", false)).RootElement;
    Check(habla.GetProperty("type").GetString() == "user_message" && habla.GetProperty("text").GetString() == "[La PC: no se pudo — No encontré «exel» (x)]", "el fallo se le dice al agente (y contesta)");
    Check(calla.GetProperty("type").GetString() == "contextual_update" && calla.GetProperty("text").GetString()!.StartsWith("[La PC: hecho"), "lo hecho, como contexto (no interrumpe)");
}
{
    var hr = new HechasRecientes();
    hr.Anotar("abre exel");
    Check(hr.Repetida(null, "abre exel"), "anotada");
    hr.Olvidar("abre exel");
    Check(!hr.Repetida(null, "abre exel"), "si falló, la orden del cerebro sí se hace");
}

// La ligera nunca cambia de avatar, captura, bloquea… por su cuenta (sin reglas ni nodo).
foreach (var f in new[] { "quién es mejor, claudio o antonio", "cómo se hace una captura de pantalla en windows", "ayer me dijiste que bloqueara la compu" })
{
    var d = await Intencion.Decidir(f, null);
    Check(!Intencion.SoloReglasONodo.Contains(d.Mano), "ligera no decide sola: " + f + " → " + d);
}
// El oído: el ruido constante del cuarto deja de ser «voz»; la voz de verdad sigue entrando.
{
    var rnd = new Random(7);
    var det = new DetectorVoz();
    int nFrases = 0, ruidos = 0;
    // 60 s de ventilador fuerte (RMS ~0.03, por encima del umbral mínimo desde el arranque).
    for (int i = 0; i < 3000; i++)
    {
        var e = det.Bloque(0.03 + (rnd.NextDouble() - 0.5) * 0.004);
        if (e == EventoVoz.Fin) nFrases++;
        if (e == EventoVoz.Ruido) ruidos++;
    }
    Check(nFrases == 0 && ruidos <= 1, $"ruido constante: ni una frase al transcriptor (frases {nFrases}, ruidos {ruidos})");
    Check(!det.Hablando && det.Umbral() > 0.03, $"al final el ruido ya no cuenta como voz (umbral {det.Umbral():0.000})");
    // Con ese ruido de fondo, una frase de 2 s con sílabas y una pausa al final sí entra.
    var fin = EventoVoz.Nada; bool empezo = false;
    for (int i = 0; i < 100; i++) { var e = det.Bloque(i % 10 < 7 ? 0.16 : 0.07); empezo |= e == EventoVoz.Empezo; }
    for (int i = 0; i < 60 && fin == EventoVoz.Nada; i++) fin = det.Bloque(0.03);
    Check(empezo && fin == EventoVoz.Fin, "la voz sobre el ruido sí entra y termina con la pausa");

    // Cuarto callado: una frase normal de 3 s no sube el umbral a sí misma y termina en la pausa.
    var q = new DetectorVoz();
    for (int i = 0; i < 200; i++) q.Bloque(0.003);
    var ev = new List<EventoVoz>();
    for (int i = 0; i < 150; i++) ev.Add(q.Bloque(i % 12 < 9 ? 0.05 : 0.02));
    for (int i = 0; i < 50; i++) ev.Add(q.Bloque(0.003));
    Check(ev.Count(x => x == EventoVoz.Empezo) == 1 && ev.Count(x => x == EventoVoz.Fin) == 1 && !ev.Contains(EventoVoz.Ruido), "una frase normal, una sola vez: " + string.Join(",", ev.Where(x => x != EventoVoz.Nada)));
}
// La conversación en vivo (Fase 1): el protocolo del agente, el canal y lo ya hecho.
{
    var ini = System.Text.Json.JsonDocument.Parse(AgenteProtocolo.Inicio("pase-1")).RootElement;
    Check(ini.GetProperty("type").GetString() == "conversation_initiation_client_data" && ini.GetProperty("dynamic_variables").GetProperty("pase").GetString() == "pase-1", "inicio con el pase como variable");
    Check(AgenteProtocolo.Audio(new byte[] { 1, 2, 3 }) == "{\"user_audio_chunk\":\"AQID\"}" && AgenteProtocolo.Pong(7) == "{\"type\":\"pong\",\"event_id\":7}", "audio y pong");
    var hola = AgenteProtocolo.Leer("{\"type\":\"conversation_initiation_metadata\",\"conversation_initiation_metadata_event\":{\"conversation_id\":\"c1\",\"agent_output_audio_format\":\"pcm_22050\",\"user_input_audio_format\":\"pcm_16000\"}}");
    Check(hola is AgenteListo { ConversacionId: "c1", Salida.Muestreo: 22050, Salida.Ulaw: false, Entrada.Muestreo: 16000 }, "formatos del agente: " + hola);
    Check(AgenteProtocolo.Leer("{\"type\":\"audio\",\"audio_event\":{\"audio_base_64\":\"AQI=\",\"event_id\":4}}") is AgenteAudio { EventoId: 4, Pcm.Length: 2 }, "audio pcm");
    Check(AgenteProtocolo.Leer("{\"type\":\"audio\",\"audio_event\":{\"audio_base_64\":\"/w==\",\"event_id\":1}}", new FormatoAudio(8000, true)) is AgenteAudio { Pcm.Length: 2 } a8 && a8.Pcm[0] == 0 && a8.Pcm[1] == 0, "μ-law 0xFF es silencio");
    Check(AgenteProtocolo.Leer("{\"type\":\"user_transcript\",\"user_transcription_event\":{\"user_transcript\":\" pon bachata \"}}") is AgenteTuDijiste { Texto: "pon bachata" }, "lo que dijiste");
    Check(AgenteProtocolo.Leer("{\"type\":\"agent_response\",\"agent_response_event\":{\"agent_response\":\"Va.\"}}") is AgenteRespuesta { Texto: "Va.", Correccion: false }, "lo que dice");
    Check(AgenteProtocolo.Leer("{\"type\":\"agent_response_correction\",\"agent_response_correction_event\":{\"original_agent_response\":\"Va, te cuento todo\",\"corrected_agent_response\":\"Va, te\"}}") is AgenteRespuesta { Texto: "Va, te", Correccion: true }, "lo que alcanzó a decir (corrige la burbuja)");
    Check(AgenteProtocolo.Leer("{\"type\":\"interruption\",\"interruption_event\":{\"event_id\":9}}") is AgenteInterrumpido { EventoId: 9 }, "interrupción");
    Check(AgenteProtocolo.Leer("{\"type\":\"ping\",\"ping_event\":{\"event_id\":3,\"ping_ms\":40}}") is AgentePing { EventoId: 3, Ms: 40 }, "ping");
    Check(AgenteProtocolo.Leer("{\"type\":\"vad_score\"}") == null && AgenteProtocolo.Leer("no es json") == null && AgenteProtocolo.Leer("{\"type\":\"audio\",\"audio_event\":{\"audio_base_64\":\"%%%\"}}") == null, "lo demás se ignora sin romper");
    Check(FormatoAudio.Leer("ulaw_8000") is { Muestreo: 8000, Ulaw: true } && FormatoAudio.Leer("raro") == FormatoAudio.Pcm16k, "formatos");

    var sseCanal = ": canal abierto\n\nid: a1\ndata: {\"id\":\"a1\",\"accion\":{\"tipo\":\"atras\"}}\n\nevent: ambiente\ndata: {\"sonido\":null}\n\nevent: pc\ndata: {\"id\":\"p1\",\"orden\":\"cierra spotify\",\"dicho\":\"ciérrame Spotify\"}\n\n: latido\n\nevent: pc\ndata: {\"id\":\"p2\",\"orden\":\"x\"}\n\n";
    var llegaron = new List<OrdenPc>();
    await CanalPc.Leer(new StringReader(sseCanal), llegaron.Add, CancellationToken.None);
    Check(llegaron.Count == 1 && llegaron[0] is { Id: "p1", Orden: "cierra spotify", Dicho: "ciérrame Spotify" }, "del canal solo las órdenes de la PC: " + string.Join(";", llegaron));

    var reloj = new Clock();
    var hechas = new HechasRecientes(reloj);
    hechas.Anotar("Abre la calculadora");
    Check(hechas.Repetida("o1", "abre la calculadora"), "lo que las reglas ya hicieron con esa frase, el cerebro no lo repite");
    Check(!hechas.Repetida("o2", "súbele más"), "otra frase (aunque se parezca) sí se hace");
    Check(hechas.Repetida("o2", "otra cosa"), "el mismo id dos veces, no");
    reloj.Now += TimeSpan.FromSeconds(61);
    Check(!hechas.Repetida("o3", "abre la calculadora"), "pasado un rato, sí se puede otra vez");
}
// «Hey AURA» con el modelo propio: despierta con «oye aura» y no con «oye laura» (clips de prueba en datos/).
{
    string? Subir(string rel) { for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent) { var p = Path.Combine(d.FullName, rel); if (Directory.Exists(p)) return p; } return null; }
    var modelos = Subir(Path.Combine("src", "Aura.Windows", "Modelos"));
    var datos = Subir(Path.Combine("tests", "datos")) ?? Subir("datos");
    Check(modelos != null && datos != null, "están los modelos y los clips de prueba");
    if (modelos != null && datos != null)
    {
        float Puntaje(string wav)
        {
            var b = File.ReadAllBytes(Path.Combine(datos, wav))[44..];
            var pcm = new short[b.Length / 2];
            Buffer.BlockCopy(b, 0, pcm, 0, pcm.Length * 2);
            using var pc = new PalabraClave(modelos, Path.Combine(modelos, "hey_aura.onnx"));
            float max = 0;
            for (int i = 0; i + 1280 <= pcm.Length; i += 1280) max = Math.Max(max, pc.Alimentar(pcm.AsSpan(i, 1280)));
            return max;
        }
        bool Despierta(string wav)
        {
            var b = File.ReadAllBytes(Path.Combine(datos, wav))[44..];
            var pcm = new short[b.Length / 2];
            Buffer.BlockCopy(b, 0, pcm, 0, pcm.Length * 2);
            using var pc = new PalabraClave(modelos, Path.Combine(modelos, "hey_aura.onnx"));
            var c = new ConfirmaPalabra();
            for (int i = 0; i + 1280 <= pcm.Length; i += 1280) if (c.Alimentar(pc.Alimentar(pcm.AsSpan(i, 1280)))) return true;
            return false;
        }
        Check(Despierta("oye_aura.wav") && !Despierta("oye_laura.wav"), "con el umbral más bajo: «oye aura» sí, «oye laura» no");
        var si = Puntaje("oye_aura.wav"); var no = Puntaje("oye_laura.wav");
        Check(si >= 0.9f, $"«oye aura» la despierta ({si:0.000}; Python da 0.973)");
        Check(no < 0.1f, $"«oye laura, ven» no ({no:0.000})");
    }
}
// ── Manos 2.1 (ManosMas): más cosas en la PC, con las mismas reglas de seguridad ──
foreach (var (f, v) in new[] { ("pon el volumen al 30", "30"), ("volume to 50%", "50"), ("pon el volumen al máximo", "100"), ("volumen a la mitad", "50"),
    ("set the volume to 20 percent", "20"), ("baja el volumen a 10", "10"), ("¿a cuánto está el volumen?", "?") })
    Check(R(f) is { Mano: Mano.VolumenA } pv && pv.Valor == v, "volumen exacto: " + f + " → " + R(f));
Check(R("pon el volumen al 300").Mano != Mano.VolumenA && R("sube el volumen") is { Mano: Mano.VolumenSubir } && R("bájale un poco") is { Mano: Mano.VolumenBajar } && R("volume up") is { Mano: Mano.VolumenSubir }, "volumen fuera de rango no; subir y bajar siguen igual");
Check(R("qué tengo abierto") is { Mano: Mano.Apps, Valor: "lista" } && R("what's open") is { Valor: "lista" } && R("qué ventanas tengo abiertas") is { Valor: "lista" }, "apps abiertas");
Check(R("cierra todas las ventanas de Excel") is { Mano: Mano.Apps, Valor: "cerrar-todas|excel", PideConfirmacion: false } && R("close all excel windows") is { Valor: "cerrar-todas|excel" }, "cerrar todas las de una app va de una");
Check(R("cierra todo") is { Mano: Mano.Apps, Valor: "cerrar-todas|", PideConfirmacion: true } && R("close all windows") is { PideConfirmacion: true }, "cerrar TODO espera el sí");
foreach (var f in new[] { "cierra chrome a la fuerza", "mata el proceso de chrome", "force quit chrome", "fuerza el cierre de chrome", "kill chrome" })
    Check(R(f) is { Mano: Mano.Apps, Valor: "forzar|chrome", PideConfirmacion: true }, "forzar cierre confirma: " + f + " → " + R(f));
Check(R("cierra chrome") is { Mano: Mano.Ventana, Valor: "cerrar|chrome" } && R("mata eso").Mano != Mano.Apps && ManosMas.NombreApp("chrome & del c: windows system32") == null && ManosMas.NombreApp("chrome; del") == "chrome del", "cerrar normal sigue igual y nombres raros no");
Check(ManosMas.ProcesosProtegidos.Contains("explorer") && ManosMas.ProcesosProtegidos.Contains("winlogon"), "Windows no se mata");
Check(R("presiona tab tres veces") is { Mano: Mano.Teclas, Valor: "TAB|3" } && R("dale enter dos veces") is { Valor: "ENTER|2" } && R("press down 5 times") is { Valor: "DOWN|5" } && R("presiona control z twice") is { Valor: "CTRL+Z|2" }, "teclas repetidas: " + R("dale enter dos veces"));
Check(R("presiona tab 50 veces").Mano != Mano.Teclas && R("presiona alt f4 dos veces").Mano != Mano.Teclas, "repetir con tope y sin combos peligrosos");
foreach (var (f, k) in new[] { ("nuevo escritorio virtual", "CTRL+WIN+D"), ("ve al siguiente escritorio", "CTRL+WIN+RIGHT"), ("escritorio anterior", "CTRL+WIN+LEFT"),
    ("mueve la ventana al otro monitor", "WIN+SHIFT+RIGHT"), ("haz un recorte de pantalla", "WIN+SHIFT+S"), ("toma una captura de una parte de la pantalla", "WIN+SHIFT+S"),
    ("graba la pantalla", "WIN+ALT+R"), ("abre el historial del portapapeles", "WIN+V"), ("abre el panel de emojis", "WIN+PERIOD"),
    ("abre una ventana de incógnito", "CTRL+SHIFT+N"), ("open a new window", "CTRL+N"), ("agrégalo a favoritos", "CTRL+D"), ("open the notification center", "WIN+N") })
    Check(R(f) is { Mano: Mano.Teclas } pt && pt.Valor == k + "|1", "atajo de windows: " + f + " → " + R(f));
Check(R("toma una captura de pantalla") is { Mano: Mano.Captura } && R("ve al escritorio") is { Mano: Mano.Escritorio } && R("resume lo que copié") is { Mano: Mano.Portapapeles }, "captura, escritorio y portapapeles siguen igual");
Check(R("activa la luz nocturna") is { Mano: Mano.Atajo, Valor: "config|nightlight" } && R("pon no molestar") is { Valor: "config|quiethours" } && R("turn on the hotspot") is { Valor: "config|network-mobilehotspot" }, "configuraciones nuevas");
Check(R("crea una carpeta Proyectos en el escritorio") is { Mano: Mano.Archivos, Valor: "carpeta|escritorio|Proyectos" } && R("crea una carpeta llamada Facturas 2026 en documentos") is { Valor: "carpeta|documentos|Facturas 2026" }
    && R("create a folder called Taxes") is { Valor: "carpeta|escritorio|Taxes" } && R("crea una carpeta en descargas llamada Viaje") is { Valor: "carpeta|descargas|Viaje" }, "crear carpeta: " + R("crea una carpeta llamada Facturas 2026 en documentos"));
Check(R("crea una carpeta en el escritorio").Mano != Mano.Archivos, "carpeta sin nombre no");
Check(ManosMas.NombreCarpetaSeguro("..\\..\\Windows") == null && ManosMas.NombreCarpetaSeguro("CON") == null && ManosMas.NombreCarpetaSeguro("a/b:c*") == "abc" && ManosMas.NombreCarpetaSeguro("Hola. ") == "Hola" && ManosMas.NombreCarpetaSeguro(new string('x', 80)) == null, "nombre de carpeta seguro");
Check(R("vacía la papelera") is { Mano: Mano.Archivos, Valor: "vaciar-papelera", PideConfirmacion: true } && R("empty the recycle bin") is { PideConfirmacion: true }, "papelera espera el sí");
Check(R("dónde está el archivo del contrato") is { Mano: Mano.Archivos, Valor: "mostrar|contrato" } && R("qué descargué hoy") is { Valor: "descargas-recientes" } && R("abre el archivo del contrato") is { Mano: Mano.AbrirArchivo }, "archivos: mostrar y descargas");
Check(R("abre el administrador de dispositivos") is { Mano: Mano.Herramienta, Valor: "dispositivos" } && R("open disk cleanup") is { Valor: "limpieza" } && R("abre la lupa") is { Valor: "lupa" } && R("abre el administrador de tareas") is { Mano: Mano.AbrirApp }, "herramientas de windows");
Check(R("abre youtube en firefox") is { Mano: Mano.Navegador, Valor: "firefox.exe|https://www.youtube.com" } && R("abre sar.gob.hn en chrome") is { Valor: "chrome.exe|https://sar.gob.hn" } && R("abre youtube") is { Mano: Mano.AbrirWeb }, "página en un navegador: " + R("abre sar.gob.hn en chrome"));
Check(R("abre javascript:alert(1) en chrome").Mano != Mano.Navegador, "navegador solo https");
Check(R("copia el texto de la pantalla") is { Mano: Mano.TextoPantalla } && R("copy the text from the screen") is { Mano: Mano.TextoPantalla }, "texto de la pantalla");
foreach (var (f, q) in new[] { ("cuánta memoria RAM estoy usando", "memoria"), ("cuál es mi IP", "ip"), ("uso de cpu", "cpu"), ("a qué wifi estoy conectado", "wifi"),
    ("what wifi am I connected to", "wifi"), ("cuánto tiempo lleva encendida la compu", "encendido"), ("qué versión de windows tengo", "version") })
    Check(R(f) is { Mano: Mano.Info } pi && pi.Valor == q, "info: " + f + " → " + R(f));
Check(R("qué hora es") is { Mano: Mano.Info, Valor: "hora" } && R("tengo internet?") is { Valor: "red" }, "info de antes sigue");
// Dos órdenes en una frase: cada una entendida sola; la escritura no va primero (su texto puede tener «y»).
var cad = R("abre el bloc de notas y escribe hola");
Check(cad.Mano == Mano.Varias && cad.Valor.Split(ManosMas.Separador) is [var c1, var c2] && R(c1).Mano == Mano.AbrirApp && R(c2) is { Mano: Mano.Escribir, Valor: "hola" }, "abre y escribe: " + cad);
Check(R("abre word y excel") is { Mano: Mano.Varias } we && we.Valor.Split(ManosMas.Separador)[1] == "abre excel", "abre word y excel: " + R("abre word y excel"));
Check(R("cierra chrome y luego abre spotify") is { Mano: Mano.Varias } && R("open notepad and then type hello world") is { Mano: Mano.Varias }, "cadena con luego / and then");
Check(R("escribe pan y leche") is { Mano: Mano.Escribir, Valor: "pan y leche" } && R("busca tom y jerry") is { Mano: Mano.BuscarWeb } && R("ayer abrí word y se trabó").Mano == Mano.Ninguna && R("pon salsa y merengue").Mano != Mano.Varias, "no se parte lo que no son dos órdenes");
Check(R("presiona control y c") is { Mano: Mano.Atajo, Valor: "teclas|CTRL+C" }, "control y c sigue siendo un atajo: " + R("presiona control y c"));
Console.WriteLine($"PASS {count} assertions");
class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
