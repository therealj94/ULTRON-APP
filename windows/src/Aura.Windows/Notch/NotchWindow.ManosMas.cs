using System;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Aura.Windows.Core;

namespace Aura.Windows.Notch;

/// <summary>
/// Las manos 2.1 (ManosMas): volumen exacto, apps abiertas, teclas repetidas y atajos de Windows, carpetas y
/// papelera, herramientas del sistema, una página en un navegador, el texto de la pantalla y dos órdenes seguidas.
/// Lo que no se deshace (forzar el cierre, cerrar todo, vaciar la papelera) espera el «sí».
/// </summary>
public partial class NotchWindow
{
    async Task HacerMas(Pedido p, bool hablado)
    {
        switch (p.Mano)
        {
            case Mano.VolumenA: VolumenA(p.Valor); break;
            case Mano.Apps: await HacerApps(p.Valor); break;
            case Mano.Teclas: await HacerTeclas(p.Valor); break;
            case Mano.Archivos: HacerArchivos(p.Valor); break;
            case Mano.Herramienta: AbrirHerramienta(p.Valor); break;
            case Mano.Navegador: AbrirEnNavegador(p.Valor); break;
            case Mano.TextoPantalla: await CopiarTextoPantalla(); break;
            case Mano.Varias: await HacerVarias(p.Valor, hablado); break;
        }
    }

    void VolumenA(string valor)
    {
        if (valor == "?")
        {
            var (nivel, mudo) = Manos.Audio.Leer();
            var dicho = mudo ? T($"El volumen está en {nivel} %, pero en silencio.", $"Volume is at {nivel}%, but muted.") : T($"El volumen está en {nivel} %.", $"Volume is at {nivel}%.");
            Hecho(dicho, "", "", dicho, segundos: 4);
            return;
        }
        var n = int.Parse(valor, System.Globalization.CultureInfo.InvariantCulture);
        Manos.Audio.Poner(n);
        Hecho(T($"Volumen al {n} %", $"Volume {n}%"), "", "");
    }

    /// <summary>Apps abiertas: decirlas, cerrar todas las de una (la app pregunta si guardar) o forzar el cierre (con «sí»).</summary>
    async Task HacerApps(string valor)
    {
        var partes = valor.Split('|', 2);
        var app = partes.Length > 1 ? partes[1] : "";
        switch (partes[0])
        {
            case "lista":
            {
                var grupos = Manos.Ventanas.TodasDe("").GroupBy(v => v.Proceso, StringComparer.OrdinalIgnoreCase)
                    .Select(g => (Nombre: NombreDeVentana(g.First().Titulo, g.Key), N: g.Count())).ToList();
                if (grupos.Count == 0) { Hecho(T("No tienes ventanas abiertas", "No windows open"), "", "", T("No tienes ninguna ventana abierta.", "You have no windows open.")); return; }
                var lista = grupos.Select(g => g.N > 1 ? $"{g.Nombre} ({g.N})" : g.Nombre).ToList();
                AgregarMensaje(ajustes.NombreAvatar, T("Abiertas: ", "Open: ") + string.Join(" · ", lista));
                Hecho(T($"{grupos.Count} apps abiertas", $"{grupos.Count} apps open"), string.Join(", ", lista.Take(6)), "",
                    T("Tienes abiertas: ", "You have open: ") + string.Join(", ", lista.Take(8)) + ".", segundos: 7);
                return;
            }
            case "cerrar-todas":
            {
                var ventanas = Manos.Ventanas.TodasDe(app);
                if (ventanas.Count == 0) { NoPude(app.Length > 0 ? T($"No veo ventanas de «{app}» abiertas.", $"I don't see any “{app}” windows open.") : T("No hay ventanas que cerrar.", "There are no windows to close.")); return; }
                async Task Cerrar()
                {
                    var (cerradas, preguntan) = await Manos.Ventanas.CerrarTodas(ventanas);
                    if (preguntan > 0) Hecho(T($"Cerré {cerradas}; {preguntan} preguntan si guardas", $"Closed {cerradas}; {preguntan} ask to save"), "", "", T("Algunas te preguntan si guardas los cambios.", "Some are asking whether to save your changes."), segundos: 5);
                    else if (cerradas > 0) Hecho(T($"Cerré {cerradas} ventanas", $"Closed {cerradas} windows"), app, "");
                    else NoPude(T("Les pedí que se cerraran y siguen abiertas.", "I asked them to close and they're still open."));
                }
                // Las de UNA app van de una (cada una pregunta si guardar). TODAS las ventanas: primero el «sí».
                if (app.Length > 0) { await Cerrar(); return; }
                Proponer(new Propuesta(T($"¿Cierro tus {ventanas.Count} ventanas?", $"Close all {ventanas.Count} windows?"), T("Las que tengan algo sin guardar te preguntarán.", "Any with unsaved work will ask you."), DateTime.Now.AddSeconds(30), Cerrar));
                return;
            }
            case "forzar":
            {
                var procesos = Manos.Ventanas.TodasDe(app).Select(v => v.Proceso).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (procesos.Count == 0 && Process.GetProcessesByName(app.Replace(" ", "")).Length > 0) procesos.Add(app.Replace(" ", ""));
                procesos.RemoveAll(n => ManosMas.ProcesosProtegidos.Contains(n) || n.Length == 0);
                if (procesos.Count == 0) { NoPude(T($"No encuentro «{app}» abierta (o es parte de Windows y no la cierro a la fuerza).", $"I can't find “{app}” running (or it's part of Windows and I won't force it closed).")); return; }
                Proponer(new Propuesta(T($"¿Cierro {app} a la fuerza?", $"Force-close {app}?"), T("Se pierde lo que no hayas guardado.", "Anything unsaved will be lost."), DateTime.Now.AddSeconds(30), async () =>
                {
                    var propio = Environment.ProcessId;
                    var todos = procesos.SelectMany(n => Process.GetProcessesByName(n)).Where(x => x.Id != propio).ToList();
                    foreach (var x in todos) { try { x.Kill(); } catch (Exception ex) { Centro.Registro.Anotar("forzar", x.ProcessName + ": " + ex.Message); } }
                    bool listo = await Verificar.Esperar(() => todos.All(x => { try { return x.HasExited; } catch { return true; } }), 4000, 200);
                    foreach (var x in todos) x.Dispose();
                    Centro.Registro.Anotar("forzar", string.Join(",", procesos));
                    if (listo) Hecho(T("Cerré a la fuerza ", "Force-closed ") + app, "", "");
                    else NoPude(T($"Windows no me dejó cerrar {app} (¿se abrió como administrador?).", $"Windows didn't let me close {app} (is it running as administrator?)."));
                }));
                return;
            }
        }
    }

    /// <summary>«Documento1 - Word» → «Word»; si no, el título o el programa.</summary>
    static string NombreDeVentana(string titulo, string proceso)
    {
        var i = titulo.LastIndexOf(" - ", StringComparison.Ordinal);
        var n = i > 0 ? titulo[(i + 3)..].Trim() : titulo.Trim();
        if (n.Length == 0 || n.Length > 30) n = proceso;
        return n;
    }

    /// <summary>Teclas a la ventana donde trabajas, `veces` veces (tope 20). Incógnito en Firefox es Ctrl+Shift+P.</summary>
    async Task HacerTeclas(string valor)
    {
        var partes = valor.Split('|');
        var combo = partes[0];
        int veces = partes.Length > 1 && int.TryParse(partes[1], out var v) ? Math.Clamp(v, 1, 20) : 1;
        if ((IsActive || centro?.IsActive == true) && Manos.Pantalla.UltimaAjena != IntPtr.Zero) { Manos.Ventanas.AlFrente(Manos.Pantalla.UltimaAjena); await Task.Delay(180); }
        var real = combo == "CTRL+SHIFT+N" && Manos.Ventanas.ProcesoAlFrente().Equals("firefox", StringComparison.OrdinalIgnoreCase) ? "CTRL+SHIFT+P" : combo;
        for (int i = 0; i < veces; i++) { Manos.Teclado.Combinacion(real); if (veces > 1) await Task.Delay(60); }
        Centro.Registro.Anotar("teclas", $"{real} ×{veces}");
        Hecho(ManosMas.NombreTeclas(combo, veces, Ingles), "", "");
    }

    void HacerArchivos(string valor)
    {
        var partes = valor.Split('|');
        switch (partes[0])
        {
            case "carpeta":
            {
                var (ruta, yaEstaba) = Manos.Archivos.CrearCarpeta(partes[1], partes[2]);
                void Abre() => Process.Start(new ProcessStartInfo("explorer.exe", "\"" + ruta + "\"") { UseShellExecute = true });
                var donde = Manos.Escritorio.NombreCarpeta(partes[1], ajustes.Idioma);
                Hecho(yaEstaba ? T("Esa carpeta ya existía", "That folder already existed") : T("Carpeta creada", "Folder created"), partes[2] + " · " + donde, "",
                    yaEstaba ? T($"Ya tenías una carpeta {partes[2]} en {donde}.", $"You already had a {partes[2]} folder in {donde}.") : T($"Listo, creé la carpeta {partes[2]} en {donde}.", $"Created the {partes[2]} folder in {donde}."),
                    T("Abrir", "Open"), Abre, 6);
                break;
            }
            case "mostrar":
            {
                var f = Manos.Sistema.BuscarArchivos(partes[1]).FirstOrDefault();
                if (f == null) { NoPude(T($"No encontré un archivo «{partes[1]}» en Descargas, Escritorio ni Documentos.", $"I couldn't find a file “{partes[1]}” in Downloads, Desktop or Documents.")); return; }
                Manos.Archivos.MostrarEnExplorador(f.FullName);
                Hecho(f.Name, f.DirectoryName ?? "", "", T("Está en ", "It's in ") + (f.Directory?.Name ?? "") + ".");
                break;
            }
            case "descargas-recientes":
            {
                var l = Manos.Archivos.Recientes();
                if (l.Count == 0) { NoPude(T("No hay descargas.", "There are no downloads.")); return; }
                AgregarMensaje(ajustes.NombreAvatar, T("Lo último que descargaste: ", "Your latest downloads: ") + string.Join(" · ", l.Select(x => x.Name)));
                Hecho(T("Últimas descargas", "Latest downloads"), string.Join(", ", l.Take(3).Select(x => x.Name)), "",
                    T("Lo último que descargaste: ", "Your latest downloads: ") + string.Join(", ", l.Take(3).Select(x => System.IO.Path.GetFileNameWithoutExtension(x.Name))) + ".",
                    T("Abrir descargas", "Open downloads"), () => Manos.Escritorio.AbrirCarpeta("descargas"), 7);
                break;
            }
            case "vaciar-papelera":
            {
                var (n, bytes) = Manos.Archivos.Papelera();
                if (n == 0) { Hecho(T("La papelera ya está vacía", "The Recycle Bin is already empty"), "", "", T("La papelera ya está vacía.", "The Recycle Bin is already empty.")); return; }
                var cuanto = n > 0 ? T($"{n} elementos, {bytes / 1048576d:0.#} MB. ", $"{n} items, {bytes / 1048576d:0.#} MB. ") : "";
                Proponer(new Propuesta(T("¿Vacío la papelera?", "Empty the Recycle Bin?"), cuanto + T("Se borran para siempre.", "They're deleted for good."), DateTime.Now.AddSeconds(30), () =>
                {
                    Manos.Archivos.VaciarPapelera();
                    Hecho(T("Papelera vacía", "Recycle Bin emptied"), "", "");
                    return Task.CompletedTask;
                }));
                break;
            }
        }
    }

    /// <summary>Herramientas de Windows por su clave: el comando es fijo (ManosMas.Herramientas), nada de la voz.</summary>
    void AbrirHerramienta(string clave)
    {
        var h = ManosMas.Herramientas.FirstOrDefault(x => x.Clave == clave);
        if (h.Clave == null) { NoPude(T("No conozco esa herramienta.", "I don't know that tool.")); return; }
        try { Process.Start(new ProcessStartInfo(h.Abrir) { UseShellExecute = true }); }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223) { NoPude(T("Cancelaste el permiso de administrador.", "You cancelled the administrator prompt.")); return; }
        Hecho(T("Abriendo ", "Opening ") + T(h.Es, h.En), "", "", T("Ahí está.", "Here it is."));
    }

    /// <summary>Una página HTTPS en el navegador pedido; si no está instalado, en el de siempre (y lo dice).</summary>
    void AbrirEnNavegador(string valor)
    {
        var partes = valor.Split('|', 2);
        var exe = partes[0]; var url = partes[1];
        if (!ManosMas.Navegadores.Values.Contains(exe) || !Commands.SafeHttps(url)) { NoPude(T("Solo abro páginas HTTPS en navegadores conocidos.", "I only open HTTPS pages in known browsers.")); return; }
        var segura = new Uri(url).AbsoluteUri; // comillas y espacios quedan codificados: un solo argumento
        var host = new Uri(url).Host;
        try
        {
            Process.Start(new ProcessStartInfo(exe, "\"" + segura + "\"") { UseShellExecute = true });
            Hecho(T("Abriendo ", "Opening ") + host, System.IO.Path.GetFileNameWithoutExtension(exe), "", T("Listo.", "Done."));
        }
        catch (System.ComponentModel.Win32Exception)
        {
            Manos.Escritorio.AbrirWeb(url);
            Hecho(T("Abriendo ", "Opening ") + host, T("en tu navegador de siempre", "in your default browser"), "",
                T("Ese navegador no está instalado; la abrí en el de siempre.", "That browser isn't installed; I opened it in your default one."));
        }
    }

    /// <summary>El texto de la ventana de trabajo (UI Automation u OCR, aquí mismo) al portapapeles.</summary>
    async Task CopiarTextoPantalla()
    {
        var lectura = await Manos.Pantalla.Leer(fuente?.Handle ?? IntPtr.Zero);
        var texto = lectura.Texto.Trim();
        if (texto.Length == 0) { NoPude(T("No encontré texto en esa ventana.", "I found no text in that window.")); return; }
        System.Windows.Clipboard.SetText(texto);
        Hecho(T("Texto copiado", "Text copied"), T($"{texto.Length} letras de ", $"{texto.Length} characters from ") + (lectura.Titulo.Length > 0 ? lectura.Titulo : lectura.Proceso), "",
            T("Copié el texto de la pantalla. Pégalo donde quieras.", "I copied the screen's text. Paste it wherever you like."));
    }

    /// <summary>
    /// Dos órdenes seguidas («abre el bloc de notas y escribe hola»). Cada una con sus propias confirmaciones;
    /// si una no sale, o espera el «sí», lo que sigue no se hace a ciegas.
    /// </summary>
    async Task HacerVarias(string valor, bool hablado)
    {
        var pasos = valor.Split(ManosMas.Separador);
        for (int i = 0; i < pasos.Length; i++)
        {
            var p = Intencion.PorReglas(pasos[i]);
            if (p.Mano is Mano.Ninguna or Mano.Varias) { NoPude(T($"No entendí «{pasos[i]}».", $"I didn't understand “{pasos[i]}”.")); return; }
            resultadoUltimo = null;
            await Hacer(p, pasos[i], hablado);
            if (i == pasos.Length - 1) break;
            if (resultadoUltimo == false) return;
            if (propuesta != null)
            {
                AgregarMensaje(ajustes.NombreAvatar, T($"Cuando me confirmes, pídeme lo demás: «{string.Join(" y ", pasos.Skip(i + 1))}».", $"Once you confirm, ask me for the rest: “{string.Join(" and ", pasos.Skip(i + 1))}”."));
                return;
            }
            // Que la app recién abierta tome el foco antes de escribir o apretar teclas en ella.
            await Task.Delay(p.Mano is Mano.AbrirApp or Mano.AbrirWeb or Mano.AbrirCarpeta or Mano.Ventana ? 700 : 250);
            if (fuente != null) Manos.Pantalla.Recordar(fuente.Handle);
        }
    }
}
