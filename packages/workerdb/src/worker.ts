import { combineLatest } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import RxDB, {
  RxCollectionCreator,
  RxDatabase,
  RxDatabaseCreator,
  PouchDB
} from 'rxdb';

declare const self: Worker;

export interface RxDatabaseCreatorWithAuth extends RxDatabaseCreator {
  authorization?: string;
}
export interface RxCollectionCreatorWithSync extends RxCollectionCreator {
  sync?: any;
  methods?: any;
}

export interface WorkerMessageBody {
  id?: string;
  type: string;
  value?: any;
  error?: Error | string;
}

export type WorkerListener = (body: WorkerMessageBody) => void;

RxDB.plugin(require('pouchdb-adapter-http'));
RxDB.plugin(require('pouchdb-adapter-idb'));

export default (
  collections: Array<RxCollectionCreatorWithSync>,
  webworker = self
) => {
  const listener = inner(collections, webworker.postMessage);
  webworker.onmessage = event => {
    const { data } = event;
    listener(data);
  };
  webworker.onerror = event => {
    console.error(event);
  };
};

export interface IWorkerOptions {
  plugins?: Function;
  init?: Function;
}
export const inner = (
  collections: Array<RxCollectionCreatorWithSync>,
  listener: WorkerListener,
  options: IWorkerOptions = {}
) => {
  let _db: Promise<RxDatabase>;
  let replicationStates: any;
  const listeners = {};
  const rx = options.plugins ? options.plugins(RxDB) : RxDB;
  const customMethods = {};
  const createDB = async (data: RxDatabaseCreatorWithAuth) => {
    if (_db) {
      const db = await _db;
      await db.destroy();
    }
    _db = rx.create({
      name: data.name || 'db',
      adapter: data.adapter || 'idb',
      multiInstance: false,
      queryChangeDetection: true
    });
    const db = await _db;
    replicationStates = {};
    await Promise.all(
      collections.map(col =>
        db.collection(col).then(c => {
          customMethods[c.name] = col.methods;
          if (col.sync) {
            if (col.sync.remote) {
              col.sync.remote = new PouchDB(
                col.sync.remote,
                data.authorization
                  ? {
                      headers: { Authorization: data.authorization }
                    }
                  : ({} as any)
              );
            }
            replicationStates[c.name] = c.sync(col.sync);
          }
          return c;
        })
      )
    );
    combineLatest(
      ...Object.keys(replicationStates).map(
        key => replicationStates[key].active$
      ),
      (...results: Array<boolean>) => {
        return results.indexOf(true) !== -1;
      }
    )
      .pipe(distinctUntilChanged())
      .subscribe(value => {
        listener({
          type: 'syncing',
          value
        });
      });
    return db;
  };

  return async (data: any) => {
    if (data.type === 'init') {
      try {
        const db = await createDB(data.value);
        if (options.init) {
          await options.init(db);
        }
        listener({
          id: data.id,
          type: 'ready'
        });
      } catch (error) {
        listener({
          id: data.id,
          type: 'error',
          error
        });
      }
      return;
    }
    const db = await _db;
    if (!db) {
      throw new Error('Not initialized');
    }
    if (data.type === 'close') {
      return db.destroy().then(() => {
        listener({
          id: data.id,
          type: data.type
        });
      });
    } else if (data.type === 'reset') {
      return db.remove().then(() => {
        listener({
          id: data.id,
          type: data.type
        });
      });
    } else if (data.type === 'stop') {
      if (listeners[data.id]) {
        listeners[data.id].unsubscribe();
        delete listeners[data.id];
      } else {
        console.warn(
          'Trying to unsubscribe from listener',
          data.id,
          'but none listening'
        );
      }
    } else if (['active'].indexOf(data.type) !== -1) {
      listeners[data.id] = replicationStates[data.collection].subscribe(
        (value: boolean) => {
          listener({
            id: data.id,
            type: data.type,
            value
          });
        }
      );
    } else if (
      (customMethods[data.collection] &&
        customMethods[data.collection][data.type]) ||
      ['find', 'findOne'].indexOf(data.type) !== -1
    ) {
      if (!db[data.collection]) {
        return listener({
          id: data.id,
          type: data.type,
          error: new Error('Could not find collection ' + data.collection)
        });
      }
      const {
        id,
        _id,
        sort,
        ...rest
      }: { id: any; _id: any; sort?: string; [x: string]: any } =
        (typeof data.value === 'string' ? { id: data.value } : data.value) ||
        {};
      const isCustom =
        customMethods[data.collection] &&
        customMethods[data.collection][data.type];

      if (isCustom) {
        const query = customMethods[data.collection][data.type](
          db[data.collection],
          id || _id || rest
        );
        return Promise.resolve(query)
          .then((value: any) =>
            listener({
              id: data.id,
              type: data.type,
              value
            })
          )
          .catch((error: Error) =>
            listener({
              id: data.id,
              type: data.type,
              error: error.message
            })
          );
      }
      let query = db[data.collection][data.type](id || _id || rest);
      if (sort) {
        query = query.sort(sort);
      }
      if (data.live === true) {
        listeners[data.id] = query.$.subscribe((value: any) => {
          listener({
            id: data.id,
            type: data.type,
            value: Array.isArray(value)
              ? value.map(x => x.toJSON())
              : value.toJSON()
          });
        });
        return query.exec();
      }
      return query
        .exec()
        .then((value: any) =>
          listener({
            id: data.id,
            type: data.type,
            value: Array.isArray(value)
              ? value.map(x => x.toJSON())
              : value.toJSON()
          })
        )
        .catch((error: Error) =>
          listener({
            id: data.id,
            type: data.type,
            error: error.message
          })
        );
    } else if (['remove'].indexOf(data.type) !== -1) {
      if (!db[data.collection]) {
        return listener({
          id: data.id,
          type: data.type,
          error: new Error('Could not find collection ' + data.collection)
        });
      }
      const value = data.value || {};
      const query = db[data.collection].findOne(
        value.id || value._id || value // eslint-disable-line
      );
      return query[data.type]()
        .then((value: any) =>
          listener({
            id: data.id,
            type: data.type,
            value: Array.isArray(value)
              ? value.map(x => x.toJSON())
              : value.toJSON()
          })
        )
        .catch((error: Error) =>
          listener({
            id: data.id,
            type: data.type,
            error: error.message
          })
        );
    } else if (['insert', 'upsert', 'update'].indexOf(data.type) !== -1) {
      if (!db[data.collection]) {
        return listener({
          id: data.id,
          type: data.type,
          error: new Error('Could not find collection ' + data.collection)
        });
      }
      if (data.value && data.value._id) {
        return db[data.collection]
          .findOne(data.value._id)
          .update({ $set: data.value })
          .then((value: any) =>
            listener({
              id: data.id,
              type: data.type,
              value: value.toJSON()
            })
          )
          .catch((error: Error) =>
            listener({
              id: data.id,
              type: data.type,
              error: error.message
            })
          );
      }
      return db[data.collection]
        [data.type](data.value)
        .then((value: any) =>
          listener({
            id: data.id,
            type: data.type,
            value: value.toJSON()
          })
        )
        .catch((error: Error) =>
          listener({
            id: data.id,
            type: data.type,
            error: error.message
          })
        );
    }
  };
};
