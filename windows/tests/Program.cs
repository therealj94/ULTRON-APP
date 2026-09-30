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
Console.WriteLine($"PASS {count} assertions");
class Clock : TimeProvider { public DateTimeOffset Now = DateTimeOffset.UtcNow; public override DateTimeOffset GetUtcNow() => Now; }
