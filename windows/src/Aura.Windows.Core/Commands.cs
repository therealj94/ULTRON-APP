using System.Globalization;
using System.Text;

namespace Aura.Windows.Core;
public enum ActionKind { None, OpenNotepad, OpenCalculator, OpenExplorer, OpenDocuments, OpenDownloads, OpenDesktop, OpenSettings, SearchWeb, OpenUrl, Draft, Pause }
public sealed record Command(ActionKind Kind, string Value = "");
public static class Commands
{
    public static string Normalize(string text) => string.Concat(text.Trim().ToLowerInvariant().Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)).Normalize(NormalizationForm.FormC);
    // This deterministic parser is the offline fallback, NOT a trained Laya model.
    public static Command Parse(string input)
    {
        if (input.Length > 4000) return new(ActionKind.None);
        input=input.Trim();
        var s = Normalize(input);
        foreach (var polite in new[] { "aura, ", "aura ", "por favor, ", "por favor " })
            if (s.StartsWith(polite, StringComparison.Ordinal)) s = s[polite.Length..].Trim();
        var exact = s.TrimEnd('.','!','?') switch {
            "abre bloc de notas" or "abrir bloc de notas" or "abre el bloc de notas" or "abre notepad" => ActionKind.OpenNotepad,
            "abre calculadora" or "abrir calculadora" or "abre la calculadora" => ActionKind.OpenCalculator,
            "abre explorador" or "abrir explorador" => ActionKind.OpenExplorer,
            "abre documentos" or "abrir documentos" or "abre mis documentos" => ActionKind.OpenDocuments,
            "abre descargas" or "abrir descargas" => ActionKind.OpenDownloads,
            "abre escritorio" or "abrir escritorio" => ActionKind.OpenDesktop,
            "abre configuracion" or "abrir configuracion" => ActionKind.OpenSettings,
            "detente" or "pausa" or "para" => ActionKind.Pause,
            _ => ActionKind.None };
        if (exact != ActionKind.None) return new(exact);
        foreach (var prefix in new[] {"busca: ", "abrir url: ", "borrador: "}) {
            if (!s.StartsWith(prefix, StringComparison.Ordinal)) continue;
            // Extract from the original separator, preserving accents and casing.
            var value = input[(input.IndexOf(':') + 1)..].Trim();
            if (value.Length == 0) return new(ActionKind.None);
            if (prefix == "abrir url: " && !SafeHttps(value)) return new(ActionKind.None);
            return new(prefix == "busca: " ? ActionKind.SearchWeb : prefix == "borrador: " ? ActionKind.Draft : ActionKind.OpenUrl, value);
        }
        foreach(var prefix in new[]{"busca ","buscar ","escribe ","redacta: "}) {
            if(!s.StartsWith(prefix,StringComparison.Ordinal))continue;
            // Text arguments stay literal; they never become executable instructions.
            var value=input[(input.Length-s.Length+prefix.Length)..].Trim();
            if(value.Length>0)return new(prefix.StartsWith("busc")?ActionKind.SearchWeb:ActionKind.Draft,value);
        }
        return new(ActionKind.None);
    }
    public static string Describe(Command command) => command.Kind switch {
        ActionKind.OpenNotepad => "Abrir Bloc de notas",
        ActionKind.OpenCalculator => "Abrir Calculadora",
        ActionKind.OpenExplorer => "Abrir Explorador de archivos",
        ActionKind.OpenDocuments => "Abrir tu carpeta Documentos",
        ActionKind.OpenSettings => "Abrir Configuración de Windows",
        ActionKind.OpenDownloads => "Abrir tu carpeta Descargas",
        ActionKind.OpenDesktop => "Abrir tu carpeta Escritorio",
        ActionKind.SearchWeb => "Buscar en el navegador: " + command.Value,
        ActionKind.OpenUrl => "Abrir esta página: " + command.Value,
        ActionKind.Draft => "Preparar este borrador: " + command.Value,
        ActionKind.Pause => "Pausar acciones", _ => "Orden no reconocida"
    };
    public static bool IsAllowed(Command command) => Enum.IsDefined(command.Kind) && command.Value.Length <= 4000 && (command.Kind switch {
        ActionKind.None or ActionKind.Pause => false,
        ActionKind.OpenUrl => SafeHttps(command.Value),
        ActionKind.SearchWeb or ActionKind.Draft => !string.IsNullOrWhiteSpace(command.Value),
        _ => command.Value.Length == 0
    });
    public static bool SafeHttps(string value) => Uri.TryCreate(value, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && string.IsNullOrEmpty(u.UserInfo) && !u.IsLoopback && Uri.CheckHostName(u.Host) == UriHostNameType.Dns && u.Host.Contains('.') && !u.Host.EndsWith(".local", StringComparison.OrdinalIgnoreCase);
}
public sealed class ApprovalGate
{
    private readonly TimeProvider clock;
    private Guid? token;
    private Command? pending;
    private DateTimeOffset expires;
    public bool Paused { get; private set; }
    public int RemainingSeconds => token == null ? 0 : Math.Max(0, (int)Math.Ceiling((expires - clock.GetUtcNow()).TotalSeconds));
    public ApprovalGate(TimeProvider? clock = null) => this.clock = clock ?? TimeProvider.System;
    public Guid Propose(Command command) {
        if (Paused || !Commands.IsAllowed(command)) throw new InvalidOperationException("Acciones pausadas o comando inválido.");
        token = Guid.NewGuid(); pending = command; expires = clock.GetUtcNow().AddSeconds(30); return token.Value;
    }
    public Command? Consume(Guid id) {
        if (Paused || token != id || clock.GetUtcNow() >= expires) return null;
        var result = pending; Cancel(); return result;
    }
    public void Cancel() { token = null; pending = null; }
    public void Pause() { Cancel(); Paused = true; }
    public void Resume() { Cancel(); Paused = false; }
}
