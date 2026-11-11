import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  attempt: vi.fn(), grade: vi.fn(), submit: vi.fn(), certify: vi.fn(), result: vi.fn(),
  tx: { $queryRaw: vi.fn(), usuario: {findUnique:vi.fn()}, attempt:{findFirst:vi.fn()}, attemptAnswer:{findMany:vi.fn(),updateMany:vi.fn()} },
}));
vi.mock('../config/prisma.js', () => ({prisma:{$transaction:async(fn:any)=>fn(mocks.tx)}}));
vi.mock('../services/progress.service.js', () => ({loadSnapshot:async()=>({
  views:[{slug:'examen-general',moduleId:'module',enabled:true}],
  modules:[{id:'module',activities:[{id:'activity',type:'QUIZ',status:'ACTIVE'}]}],
  evaluations:new Map([['activity',{minimumScore:80}]]),
  // El usuario llega en la misma consulta del estado de formación.
  user:await mocks.tx.usuario.findUnique(),
})}));
vi.mock('../domain/final-exam.js', async (original) => ({...await original<any>(),gradeFinalExam:mocks.grade}));
vi.mock('../services/attempt.service.js', () => ({startAttemptTx:vi.fn(),submitAttemptTx:mocks.submit}));
vi.mock('../services/evaluation-result.service.js', () => ({attemptResults:mocks.result}));
vi.mock('../services/automatic-certification.service.js', () => ({certifyAfterFinalExam:mocks.certify}));
vi.mock('../services/catalog.service.js', () => ({createEvaluationVersion:vi.fn()}));
import { submitFinalExam } from '../services/final-exam.service.js';
describe('envío del examen y emisión del certificado', () => {
  beforeEach(()=>{
    vi.resetAllMocks(); mocks.tx.usuario.findUnique.mockResolvedValue({rol:'asesor',estado:'activo'});
    mocks.tx.attempt.findFirst.mockResolvedValue({id:'attempt'});
    mocks.tx.attemptAnswer.findMany.mockResolvedValue([{questionId:'q',optionId:'A'}]);
    mocks.grade.mockReturnValue({passed:true,score:100,answers:[]});
    mocks.result.mockResolvedValue(new Map([['attempt',{passed:true}]]));
  });
  it('guarda el examen antes de emitir y usa la misma transacción', async()=>{
    await submitFinalExam('advisor');
    expect(mocks.certify).toHaveBeenCalledWith(mocks.tx,'advisor',expect.any(Date));
    expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(mocks.certify.mock.invocationCallOrder[0]!);
  });
  it('no intenta certificar si el examen no se aprueba',async()=>{
    mocks.grade.mockReturnValue({passed:false,score:20,answers:[]});
    await submitFinalExam('advisor'); expect(mocks.certify).not.toHaveBeenCalled();
  });
  it('propaga el fallo de emisión para no confirmar una transacción parcial',async()=>{
    mocks.certify.mockRejectedValue(new Error('Database unavailable'));
    await expect(submitFinalExam('advisor')).rejects.toThrow('Database unavailable');
    expect(mocks.result).not.toHaveBeenCalled();
  });
  it('un doble envío reutiliza el intento aprobado sin volver a calificar',async()=>{
    mocks.tx.attempt.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({id:'attempt'});
    expect(await submitFinalExam('advisor')).toMatchObject({alreadySubmitted:true});
    expect(mocks.grade).not.toHaveBeenCalled(); expect(mocks.certify).toHaveBeenCalledTimes(1);
  });
});
