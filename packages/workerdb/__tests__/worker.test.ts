import 'jest';
import worker, { inner } from '../src/worker';

describe('index', () => {
  it('should be able to be included', () => {
    worker([
      {
        name: 'bird',
        schema: {
          type: 'object',
          version: 0,
          properties: {
            name: { type: 'string' }
          }
        }
      }
    ]);
  });
  it('should be able to be start', async () => {
    const listener = await getWorker();
    await listener({ type: 'close' });
  });
  it('should be able to be query', async () => {
    let invocations = 0;
    let results: Array<any> = [];
    const listener = await getWorker((data: any) => {
      invocations += 1;
      results.push(data.value);
    });
    await listener({ type: 'find', collection: 'bird' });
    await listener({
      type: 'insert',
      value: { name: 'Filou' },
      collection: 'bird'
    });
    await listener({ type: 'find', collection: 'bird' });
    await listener({ type: 'close' });
    expect(invocations).toBe(3);
    expect(results[0]).toEqual([]);
    expect(results[1]).toBeTruthy();
    expect(results[1].name).toBe('Filou');
    expect(results[2]).toBeTruthy();
    expect(results[2][0]).toBeTruthy();
    expect(results[2][0].name).toBe('Filou');
  });
});

const getWorker = (cb?: Function): Promise<Function> => {
  let resolved = false;
  return new Promise((yay, nay) => {
    const listener = inner(
      [
        {
          name: 'bird',
          schema: {
            type: 'object',
            version: 0,
            properties: {
              name: { type: 'string' }
            }
          }
        }
      ],
      data => {
        if (data.type === 'ready') {
          resolved = true;
          yay(listener);
        } else if (cb) {
          cb(data);
        }
      },
      (rx: any) => {
        rx.plugin(require('pouchdb-adapter-memory'));
        return rx;
      }
    );
    listener({
      type: 'init',
      value: {
        adapter: 'memory'
      }
    });
    setTimeout(() => {
      if (!resolved) {
        nay();
      }
    }, 1000);
  });
};
